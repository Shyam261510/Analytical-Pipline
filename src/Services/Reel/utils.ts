import { redis } from "../../Provider/RedisProvider";
import { EXPIRY } from "../../constants";
type ReelProgress = {
  scrapeMetaCount: number;
  downloadVideoCount: number;
  extractAudioCount: number;
  transcribeAudioCount: number;
};

async function updateProgress(
  username: string,
  field: keyof ReelProgress,
): Promise<number> {
  const key = `IG_USERNAME:${username}_PROGRESS`;
  const count = await redis.getClient().hincrby(key, field, 1);
  await redis.getClient().expire(key, EXPIRY);
  return count;
}

const reportGateKey = (username: string) => `IG_USERNAME:${username}_REPORT_GATE`;

// The report needs two things: all reels transcribed AND the external-links crawl
// finished (or skipped). Each part calls markReportPartDone when it is done; the
// call that makes the count reach 2 returns true and must write the report.
export async function resetReportGate(username: string): Promise<void> {
  await redis.getClient().del(reportGateKey(username));
}

export async function markReportPartDone(username: string): Promise<boolean> {
  const key = reportGateKey(username);
  const count = await redis.getClient().incr(key);
  await redis.getClient().expire(key, EXPIRY);
  return count === 2;
}

export async function isProgressComplete(
  username: string,
  reelCode: string,
  field: keyof ReelProgress,
  stage: string,
  detail?: string,
): Promise<boolean> {
  const count = await updateProgress(username, field);

  if (count === 12) {
    console.log(`✅ @${username} | ${stage} complete (12/12)`);
    return true;
  }
  console.log(
    `📊 @${username} | ${stage} ${count}/12 | ${reelCode} ${detail && ` | ${detail}`}`,
  );
  return false;
}
