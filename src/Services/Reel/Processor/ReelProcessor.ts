import { ReelProcessingService } from "../ReelProcessService";
import { redis } from "../../../Provider/RedisProvider";
import type { Job } from "bullmq";
import type {
  ScrapeReelMetaJob,
  DownloadReelJob,
  ExtractAudioJob,
  TranscibeAudioJob,
} from "../../../queue/types";
import { EXPIRY } from "../../../constants";

export class ReelProcessor extends ReelProcessingService {
  async scrapeReelMetaProcessor(job: Job<ScrapeReelMetaJob>) {
    const { username, reelCode } = job.data;

    const response = await this.handleGetReelMetaInfo(username, reelCode);

    if (!response.success) {
      throw new Error(response.message);
    }
  }

  async downloadReelProcessor(job: Job<DownloadReelJob>) {
    const { username, reelCode, reelUrl } = job.data;
    const response = await this.downloadReel(username, reelCode, reelUrl);

    if (!response.success) {
      throw new Error(response.message);
    }
  }

  async extractAudioProcessor(job: Job<ExtractAudioJob>) {
    const { username, reelCode, videoPath } = job.data;
    const response = await this.extractReelAudio(username, reelCode, videoPath);

    if (!response.success) {
      throw new Error(response.message);
    }
  }

  async transcribeLocalAudioProcessor(job: Job<TranscibeAudioJob>) {
    const { username, reelCode, audioPath } = job.data;

    const response = await this.transcibeAudioAndSave(
      username,
      reelCode,
      audioPath,
    );
    if (!response.success) {
      throw new Error(response.message);
    }
  }

  // Called once a job is out of retries, so one bad reel can't leave a user pending forever.
  async markReelFailed(username: string, reelCode: string, error: string) {
    const reelMetaKey = `IG_USERNAME_REEL_INFO:${username}_${reelCode}`;

    await redis.setHashValue(reelMetaKey, { status: "failed", error }, EXPIRY);
  }
}
