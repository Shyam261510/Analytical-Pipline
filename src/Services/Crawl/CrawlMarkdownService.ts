import { handleAsync } from "../../shared/handleAsync";
import { getCloudflareCrawler } from "./CrawlService";

export type CrawlStatus = "pending" | "crawling" | "done" | "error";

// Called on every status change of a URL, e.g. to update the Redis cache.
export type CrawlStatusHandler = (
  status: CrawlStatus,
  url: string,
) => void | Promise<void>;

// What happened to one URL. "empty" = crawled fine but no page produced markdown.
export type CrawlUrlResult = {
  url: string;
  status: "done" | "empty" | "error";
  pages: number;
  error?: string;
};

export type CrawlOutcome = {
  // Markdown of every crawled page, each under a "## <page url>" header
  markdown: string;
  urls: CrawlUrlResult[];
};

// Crawls at most this many URLs at once (Cloudflare rate limits)
const CRAWL_CONCURRENCY = 2;
// Size caps so one huge page can't blow up Redis, the report or a later LLM call
const MAX_PAGE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 100_000;
const PAGE_SEPARATOR = "\n\n---\n\n";

// Parses and normalises a URL. Returns null for anything that is not http(s).
function normalizeUrl(raw: string): { url: string; key: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  parsed.hash = "";
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/+$/, "");
  // Same site with/without www, trailing slash or http/https is the same page
  const key = `${host}${path}${parsed.search}`;
  return { url: parsed.href, key };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n\n[...truncated]` : text;
}

// Runs `fn` over `items`, at most `limit` at a time. `fn` must not throw.
async function runLimited<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i] as T, i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}

// Crawls every URL and returns the combined markdown plus a per-URL result.
// A failing URL does not fail the whole call: it is reported as "error" with its message.
export async function crawlUrlsToMarkdown(
  urls: string[],
  onStatusChange?: CrawlStatusHandler,
): Promise<ServiceResult<CrawlOutcome>> {
  return handleAsync(async () => {
    // Keep valid http(s) URLs only, each site/page once
    const unique = new Map<string, string>();
    for (const raw of urls) {
      const normalized = normalizeUrl(raw);
      if (!normalized) {
        console.warn(`[Crawl] skipping invalid or non-http URL: ${raw}`);
        continue;
      }
      if (!unique.has(normalized.key)) unique.set(normalized.key, normalized.url);
    }
    const uniqueUrls = [...unique.values()];

    // A failing handler (e.g. Redis down) must never break the crawl itself
    const report = async (status: CrawlStatus, url: string) => {
      try {
        await onStatusChange?.(status, url);
      } catch (err) {
        console.warn(
          `[Crawl] status handler failed for ${url} (${status}): ${err instanceof Error ? err.message : err}`,
        );
      }
    };

    // Every URL starts as pending
    await Promise.all(uniqueUrls.map((url) => report("pending", url)));

    const results: CrawlUrlResult[] = new Array(uniqueUrls.length);
    // One entry per URL, in input order, so the output order is stable
    const pagesPerUrl: string[][] = new Array(uniqueUrls.length);

    await runLimited(uniqueUrls, CRAWL_CONCURRENCY, async (url, i) => {
      await report("crawling", url);

      try {
        const records = await getCloudflareCrawler().crawl({
          url,
          formats: ["markdown"],
        });

        // Keep only pages that actually produced markdown, labelled with their own URL
        const pages = records
          .map((record) => ({
            url: record.url || url,
            markdown: record.markdown?.trim(),
          }))
          .filter((p): p is { url: string; markdown: string } => !!p.markdown)
          .map(
            (p) => `## ${p.url}\n\n${truncate(p.markdown, MAX_PAGE_CHARS)}`,
          );

        pagesPerUrl[i] = pages;
        results[i] = {
          url,
          status: pages.length > 0 ? "done" : "empty",
          pages: pages.length,
        };
        await report(pages.length > 0 ? "done" : "error", url);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Crawl] ${url} failed: ${message}`);
        pagesPerUrl[i] = [];
        results[i] = { url, status: "error", pages: 0, error: message };
        await report("error", url);
      }
    });

    const markdown = truncate(
      pagesPerUrl.flat().join(PAGE_SEPARATOR),
      MAX_TOTAL_CHARS,
    );
    return { markdown, urls: results };
  }, "Error in crawling URLs to markdown");
}
