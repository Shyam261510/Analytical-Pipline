import type { Job } from "bullmq";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CrawlUrlJob } from "../../../queue/types";
import { EXPIRY } from "../../../constants";
import { redis } from "../../../Provider/RedisProvider";
import { crawlUrlsToMarkdown } from "../CrawlMarkdownService";
import { ReelReportService } from "../../Reel/helper/ReelReportService";
import { markReportPartDone } from "../../Reel/utils";

// Overall state of the external-links crawl for one profile
type JobCrawlStatus = "crawling" | "done" | "error";

export class CrawlUrlProcessor {
  private reelReportService = new ReelReportService();

  // BullMQ processor: unpacks the job and runs the crawl; a throw makes BullMQ retry
  async crawlUrlsProcessor(job: Job<CrawlUrlJob>) {
    const { username, urls } = job.data;
    console.log(`Total Crawling urls ${urls.length} | @${username}`);
    await this.crawlUrls(username, urls);
  }

  // Runs once the job has used up all its retries: record the failure and let the
  // report go ahead without the external markdown.
  async markCrawlFailed(job: Job<CrawlUrlJob>, error: string) {
    const { username } = job.data;
    await this.setStatus(username, "error", error);
    await this.finishReportPart(username);
  }

  private profileKey(username: string) {
    return `IG_USERNAME_PROFILE:${username}`;
  }

  // One overall status for the job (not one per URL), with the error message if any
  private async setStatus(
    username: string,
    status: JobCrawlStatus,
    error?: string,
  ) {
    await redis.setHashValue(
      this.profileKey(username),
      { crawlStatus: status, crawlError: error ?? "" },
      EXPIRY,
    );
  }

  // Crawls the URLs, saves the combined markdown to Redis and to output/markdown/<username>.md
  private async crawlUrls(username: string, urls: string[]) {
    await this.setStatus(username, "crawling");

    const result = await crawlUrlsToMarkdown(urls);
    if (!result.success) throw new Error(result.message);

    const { markdown, urls: perUrl } = result.data;
    const failed = perUrl.filter((u) => u.status === "error");
    console.log(
      `Crawling complete for @${username}: ${perUrl.length - failed.length}/${perUrl.length} URLs ok`,
    );

    // Nothing usable came back: throw so BullMQ retries, and keep any markdown
    // saved by an earlier run instead of overwriting it with an empty string.
    if (!markdown) {
      const reason =
        failed.map((u) => `${u.url}: ${u.error}`).join("; ") ||
        "no page produced markdown";
      throw new Error(`Crawl produced no markdown (${reason})`);
    }

    // The crawl already cost money, so retry the saves on their own instead of
    // failing the job (which would re-crawl everything).
    await this.withRetry(() =>
      redis.setHashValue(
        this.profileKey(username),
        { externalMarkdown: markdown },
        EXPIRY,
      ),
    );
    // await this.saveMarkdownFile(username, markdown);

    // "done" only after the markdown is saved, so a reader never sees done without it
    await this.setStatus(username, "done");
    await this.finishReportPart(username);
  }

  // Writes output/markdown/<username>.md (temp file + rename: never a half-written file)
  private async saveMarkdownFile(username: string, markdown: string) {
    try {
      const safeName = username.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = path.join("output", "markdown", `${safeName}.md`);
      await mkdir(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.${process.pid}.tmp`;
      await writeFile(temp, markdown + "\n", "utf8");
      await rename(temp, filePath);
      console.log(`✅ Markdown saved at: ${filePath}`);
    } catch (err) {
      // The Redis copy is saved already; a file error must not re-run the crawl
      console.warn(
        `Markdown file not saved for @${username}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // The report waits for both the reels and this crawl. Whoever finishes last writes it.
  private async finishReportPart(username: string) {
    if (!(await markReportPartDone(username))) return;
    const report = await this.reelReportService.saveReportToTxt(username);
    if (!report.success) {
      console.warn(`Report not saved for @${username}: ${report.message}`);
    }
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 500 * 2 ** i));
      }
    }
    throw lastErr;
  }
}
