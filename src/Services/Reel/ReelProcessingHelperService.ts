import type { ReelCodeInfo, ReelMetadata } from "./type.reel";

import { redis } from "../../Provider/RedisProvider";
import { handleAsync } from "../../shared/handleAsync";
import { EXPIRY } from "../../constants";
import path from "node:path";
import { isProgressComplete, markReportPartDone, resetReportGate } from "./utils";
import { queues } from "../../queue/defination";
import { queueNames } from "../../queue/config";
import { AudioExtractionService } from "./helper/AudioExtractionService";
import { DownloadVideoService } from "./helper/DownloadVideoService";
import { TranscribeAudioService } from "./helper/TranscribeAudioService";
import { ReelReportService } from "./helper/ReelReportService";
import { InstagramService } from "../Instagram/InstagramService";

export class ReelProcessingHelperService {
  private downloadVideoService = new DownloadVideoService();
  private audioExtractionService = new AudioExtractionService();
  private transcribeAudioService = new TranscribeAudioService();
  private reelReportService = new ReelReportService();
  private instagramService = new InstagramService();

  // Redis cache TTL in seconds (6 hours)
  protected readonly EXPIRY = 21600;

  // Fetches the latest 12 reel codes for a user and caches them in Redis
  protected async handleExtractReelCode(
    username: string,
  ): Promise<ServiceResult<ReelCodeInfo>> {
    // KEY for all scraped codes in Redis
    const reelsCodeKey = `IG_USERNAME:${username}_REEL_CODES`;
    // KEY for account Info in Redis
    const profileKey = `IG_USERNAME_PROFILE:${username}`;
    return handleAsync(async () => {
      const result =
        await this.instagramService.handleExtractReelCode(username);

      if (!result.success) {
        throw new Error(result.message);
      }
      const { profile, reel_codes } = result.data;

      // New run: forget the previous run's report gate, and drop its crawl output so
      // the report never shows old markdown while the new crawl is still running.
      await resetReportGate(username);
      await redis.getClient().hdel(profileKey, "externalMarkdown", "crawlStatus", "crawlError");

      await redis.setHashValue(profileKey, profile, EXPIRY);

      // Store Reel Code info in Redis

      await redis.setList(reelsCodeKey, reel_codes, EXPIRY);

      console.log(`Total reels scrape ${reel_codes.length}`);

      const externalLinks = [
        ...(profile.bio_links ?? []),
        profile.externalUrl,
      ].filter(
        (url): url is string => typeof url === "string" && url.trim() !== "",
      );

      if (externalLinks.length > 0) {
        await queues.crawlUrlQueue.add(queueNames.externalUrlCrawl, {
          username,
          urls: externalLinks,
        });
      } else {
        // No crawl will run, so that part of the report is already complete
        await markReportPartDone(username);
      }

      console.log(
        `[INFO] [Reels Service] Successfully fetched ${reel_codes.length} reels for @${username}.`,
      );

      return { username, reel_codes: reel_codes.splice(0, 12) };
    }, `Error in EXTRACTING top 12 Reel Code of ${username}`);
  }
  // Fetches metadata (views, likes, video URL, ...) for a single reel and caches it in Redis
  protected async handleGetReelMetaInfo(
    username: string,
    code: string,
  ): Promise<ServiceResult<ReelMetadata>> {
    const reelMetaKey = `IG_USERNAME_REEL_INFO:${username}_${code}`;
    return handleAsync(async () => {
      const result = await this.instagramService.getReelMeta(code);
      if (!result.success) {
        throw new Error(result.message);
      }
      const data = result.data;

      // A reel without a video URL has nothing to download, so the pipeline stops here.
      if (!data.video_url) {
        await redis.setHashValue(
          reelMetaKey,
          { ...result, status: "no_video" },
          EXPIRY,
        );

        return data;
      }

      // Normal case: cache the metadata
      await redis.setHashValue(reelMetaKey, data, EXPIRY);

      // A fixed jobId makes a retried meta job a no-op here instead of a duplicate download.
      await queues.downloadReelQueue.add(
        queueNames.downloadReel,
        { username, reelCode: code, reelUrl: data.video_url },
        { jobId: `download-${code}` },
      );

      await isProgressComplete(
        username,
        code,
        "scrapeMetaCount",
        "meta",
        `${data.video_duration}s, ${data.like_count} likes`,
      );

      return data;
    }, `Error in fetching Reel Meta Info of ${code} for ${username}`);
  }

  // Downloads a reel video, then queues audio extraction and updates progress
  protected async downloadReel(
    username: string,
    reelCode: string,
    reelUrl: string,
  ): Promise<ServiceResult<string>> {
    return handleAsync(async () => {
      const videoPath = this.reelVideoPath(username, reelCode);
      const result = await this.downloadVideoService.convertURlToVideo(
        reelUrl,
        videoPath,
      );
      if (!result.success) {
        throw new Error(`${result.message} (to ${videoPath})`);
      }

      await queues.audioExtractQueue.add(
        queueNames.audioExtract,
        { username, reelCode, videoPath },
        { jobId: `audio-${reelCode}` },
      );
      await isProgressComplete(
        username,
        reelCode,
        "downloadVideoCount",
        "download",
        videoPath,
      );

      return videoPath;
    }, `Error in downloading Reel ${reelCode} for ${username}`);
  }

  // Extracts audio from a downloaded reel, then queues transcription and updates progress
  protected async extractReelAudio(
    username: string,
    reelCode: string,
    videoPath: string,
  ): Promise<ServiceResult<string>> {
    return handleAsync(async () => {
      const audioDir = this.reelAudioDir(username);
      const result = await this.audioExtractionService.extractAudio(
        videoPath,
        audioDir,
      );
      if (!result.success) throw new Error(result.message);

      await queues.transcribeAudioQueue.add(
        queueNames.transcribeAudio,
        { username, reelCode, audioPath: result.data },
        { jobId: `transcribe-${reelCode}` },
      );
      await isProgressComplete(
        username,
        reelCode,
        "extractAudioCount",
        "audio",
        result.data,
      );

      return result.data;
    }, `Error in extracting audio of Reel ${reelCode} for ${username}`);
  }

  protected async transcibeAudioAndSave(
    username: string,
    reelCode: string,
    audioPath: string,
  ) {
    return handleAsync(async () => {
      const result =
        await this.transcribeAudioService.transcribeLocalAudio(audioPath);
      if (!result.success) throw new Error(result.message);

      const transcibe = {
        fullTranscibe: result.data.map((s) => s.text).join(" "),
        segments: result.data,
      };

      const reelMetaKey = `IG_USERNAME_REEL_INFO:${username}_${reelCode}`;

      await redis.setHashValue(reelMetaKey, transcibe, this.EXPIRY);

      const allDone = await isProgressComplete(
        username,
        reelCode,
        "transcribeAudioCount",
        "transcription",
      );

      // Last reel transcribed: write the report, unless the external-links crawl is
      // still running (it writes the report when it finishes). A report failure must
      // not fail this job, because a retry would count this reel in the progress twice.
      if (allDone && (await markReportPartDone(username))) {
        const report = await this.reelReportService.saveReportToTxt(username);
        if (!report.success) {
          console.warn(`Report not saved for @${username}: ${report.message}`);
        }
      }

      return transcibe;
    }, `Error in transcribing and saving Reel ${reelCode} for ${username}`);
  }

  // Converts an Instagram shortcode (base64-like) to its numeric media id
  private shortcodeToMediaId(shortcode: string) {
    // Instagram's base64 alphabet (URL-safe)
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    // BigInt is needed because media ids exceed Number's safe integer range
    let mediaId = BigInt(0);

    // Treat each character as a base-64 digit
    for (let i = 0; i < shortcode.length; i++) {
      const char = shortcode[i];
      const index = alphabet.indexOf(char as string);
      if (index === -1) {
        throw new Error(`Invalid character "${char}" in shortcode`);
      }
      mediaId = mediaId * BigInt(64) + BigInt(index);
    }

    return mediaId.toString();
  }

  // Folder only: extractAudio names the file after the video (<code>_<date>.mp3)
  private reelAudioDir(username: string) {
    return path.join("output", "audio", username);
  }
  private reelVideoPath(username: string, reelCode: string) {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return path.join("output", "videos", username, `${reelCode}_${date}.mp4`);
  }
}
