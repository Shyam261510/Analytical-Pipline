import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { redis } from "../../../Provider/RedisProvider";
import { handleAsync } from "../../../shared/handleAsync";

type ProfileFields = {
  username: string;
  fullName: string;
  biography: string;
  isPrivate: boolean;
  isVerified: boolean;
  followerCount: number;
  followingCount: number;
  bio_links: string[];
  externalUrl: string;
  externalMarkdown: string;
};

type ReelFields = {
  caption: string;
  fullTranscibe: string;
  like_count: number;
  comment_count: number;
  play_count: number;
  ig_play_count: number;
};

const PROFILE_FIELDS: (keyof ProfileFields)[] = [
  "username",
  "fullName",
  "biography",
  "isPrivate",
  "isVerified",
  "followerCount",
  "followingCount",
  "bio_links",
  "externalUrl",
  "externalMarkdown",
];

const REEL_FIELDS: (keyof ReelFields)[] = [
  "caption",
  "fullTranscibe",
  "like_count",
  "comment_count",
  "play_count",
  "ig_play_count",
];

const NOT_AVAILABLE = "N/A";

// Shows a value as text, or N/A when it was never stored
function show(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return NOT_AVAILABLE;
  }
  return String(value);
}

// Reads the named fields of a Redis hash into an object (missing fields stay undefined)
async function readHash<T extends object>(
  key: string,
  fields: (keyof T & string)[],
): Promise<Partial<T>> {
  const values = await redis.getHashValue<unknown>(key, fields);
  const result: Record<string, unknown> = {};
  fields.forEach((field, i) => {
    const value = values[i];
    if (value !== null && value !== undefined) result[field] = value;
  });
  return result as Partial<T>;
}

export class ReelReportService {
  // Builds a text report (profile, external links markdown, every reel with its
  // transcription and metrics) from Redis and saves it as a .txt file.
  // Returns the saved file path.
  async saveReportToTxt(username: string): Promise<ServiceResult<string>> {
    return handleAsync(async () => {
      const profile = await readHash<ProfileFields>(
        `IG_USERNAME_PROFILE:${username}`,
        PROFILE_FIELDS,
      );

      // The list was filled with LPUSH, so it comes back in reverse; flip it
      // to get the reels in the order Instagram returned them.
      const codes = [
        ...(await redis
          .getClient()
          .lrange(`IG_USERNAME:${username}_REEL_CODES`, 0, -1)),
      ].reverse();

      const reels = await Promise.all(
        codes.map(async (code) => ({
          code,
          ...(await readHash<ReelFields>(
            `IG_USERNAME_REEL_INFO:${username}_${code}`,
            REEL_FIELDS,
          )),
        })),
      );

      const report = this.buildReport(username, profile, reels);

      const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const filePath = path.join(
        "output",
        "reports",
        `${username}_${date}.txt`,
      );

      // Write to a temp file, then rename: a crash mid-write never leaves half a report.
      await mkdir(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${process.pid}.tmp`;
      await writeFile(temp, report, "utf8");
      await rename(temp, filePath);

      console.log(`✅ Report saved at: ${filePath}`);
      return filePath;
    }, `Error in saving report of ${username}`);
  }

  private buildReport(
    username: string,
    profile: Partial<ProfileFields>,
    reels: (Partial<ReelFields> & { code: string })[],
  ): string {
    const bioLinks = profile.bio_links?.length
      ? profile.bio_links.join("\n")
      : NOT_AVAILABLE;

    const lines: string[] = [
      "========== PROFILE ==========",
      `Username: ${show(profile.username ?? username)}`,
      `Full name: ${show(profile.fullName)}`,
      `Bio: ${show(profile.biography)}`,
      `Private: ${show(profile.isPrivate)}`,
      `Verified: ${show(profile.isVerified)}`,
      `Followers: ${show(profile.followerCount)}`,
      `Following: ${show(profile.followingCount)}`,
      `External link: ${show(profile.externalUrl)}`,
      `Bio links:\n${bioLinks}`,
      "",
      "========== EXTERNAL LINKS MARKDOWN ==========",
      show(profile.externalMarkdown),
      "",
      "========== REELS ==========",
    ];

    reels.forEach((reel, i) => {
      // ig_play_count is the Instagram-only count; play_count includes other surfaces
      const views = reel.play_count ?? reel.ig_play_count;
      lines.push(
        "",
        `Reel ${i + 1} -> "${reel.caption ?? ""}"`,
        `Link: https://www.instagram.com/reel/${reel.code}/`,
        `Transcription: ${show(reel.fullTranscibe)}`,
        `Likes: ${show(reel.like_count)} | Comments: ${show(reel.comment_count)} | Views: ${show(views)}`,
      );
    });

    return lines.join("\n") + "\n";
  }
}
