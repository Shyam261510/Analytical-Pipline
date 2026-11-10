import axios, { type AxiosInstance } from "axios";

// --------------------
// Types
// --------------------

interface CrawlOptions {
  url: string;
  formats?: "markdown"[];
}

export interface CrawlRecord {
  url: string;
  status: string;
  markdown?: string;
  metadata?: {
    title?: string;
    status?: number;
    url?: string;
  };
}

interface CrawlResult {
  id: string;
  status: string;
  total: number;
  finished: number;
  records: CrawlRecord[];
  cursor?: string;
}

// --------------------
// Cloudflare Crawler
// --------------------

class CloudflareCrawler {
  private readonly client: AxiosInstance;

  // Only 2 pages are fetched per URL (the page itself + one more), so a depth of 1
  // is enough; a deeper crawl would just add time without more pages.
  private readonly CRAWL_LIMIT = 2;
  private readonly CRAWL_DEPTH = 1;
  private readonly RESULT_LIMIT = 100;
  // Hard stop for record pagination so a misbehaving cursor can never loop forever
  private readonly MAX_RECORD_PAGES = 50;

  private readonly MAX_POLL_ATTEMPTS = 60;
  private readonly POLL_DELAY_MS = 5000;
  // A single failed status poll (429, network blip) must not abandon a running crawl
  private readonly MAX_CONSECUTIVE_POLL_ERRORS = 3;

  constructor() {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
      throw new Error("Missing Cloudflare credentials");
    }

    this.client = axios.create({
      baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering`,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      timeout: 30_000,
    });
  }

  // Start crawl
  private async startCrawl(options: CrawlOptions): Promise<string> {
    const { data } = await this.client.post("/crawl", {
      url: options.url,
      limit: this.CRAWL_LIMIT,
      depth: this.CRAWL_DEPTH,
      formats: options.formats ?? ["markdown"],
    });

    if (!data.success) {
      throw new Error("Failed to start Cloudflare crawl");
    }

    return data.result as string;
  }

  // Get crawl status
  async getCrawlResult(
    jobId: string,
    limit = this.RESULT_LIMIT,
  ): Promise<CrawlResult> {
    const { data } = await this.client.get(`/crawl/${jobId}`, {
      params: { limit },
    });

    if (!data.success) {
      throw new Error("Failed to retrieve crawl results");
    }

    return data.result as CrawlResult;
  }

  // Wait for completion
  private async waitForCrawl(jobId: string): Promise<CrawlResult> {
    let consecutiveErrors = 0;

    for (let attempt = 0; attempt < this.MAX_POLL_ATTEMPTS; attempt++) {
      let result: CrawlResult;
      try {
        result = await this.getCrawlResult(jobId, 1);
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        console.warn(
          `[Crawl] poll failed for job ${jobId} (${consecutiveErrors}/${this.MAX_CONSECUTIVE_POLL_ERRORS}): ${err instanceof Error ? err.message : err}`,
        );
        if (consecutiveErrors >= this.MAX_CONSECUTIVE_POLL_ERRORS) throw err;
        await new Promise((resolve) => setTimeout(resolve, this.POLL_DELAY_MS));
        continue;
      }

      if (result.status === "completed") {
        return result;
      }

      if (
        result.status === "errored" ||
        result.status.startsWith("cancelled")
      ) {
        throw new Error(`Crawl failed: ${result.status}`);
      }

      await new Promise((resolve) => setTimeout(resolve, this.POLL_DELAY_MS));
    }

    throw new Error("Crawl polling timed out");
  }

  // Fetch all records
  private async fetchAllCrawlRecords(jobId: string): Promise<CrawlRecord[]> {
    const records: CrawlRecord[] = [];
    let cursor: string | undefined;
    let pages = 0;

    do {
      if (++pages > this.MAX_RECORD_PAGES) {
        throw new Error(
          `Crawl ${jobId}: more than ${this.MAX_RECORD_PAGES} record pages, giving up`,
        );
      }
      const { data } = await this.client.get(`/crawl/${jobId}`, {
        params: {
          limit: this.RESULT_LIMIT,
          ...(cursor ? { cursor } : {}),
        },
      });

      if (!data.success) {
        throw new Error("Failed to fetch crawl records");
      }

      records.push(...data.result.records);
      cursor = data.result.cursor;
    } while (cursor);

    return records;
  }

  // Complete crawl workflow
  async crawl(options: CrawlOptions): Promise<CrawlRecord[]> {
    const jobId = await this.startCrawl(options);

    console.log(`Crawl started: ${options.url} | Job: ${jobId}`);

    await this.waitForCrawl(jobId);

    const records = await this.fetchAllCrawlRecords(jobId);

    console.log(`Crawl completed: ${options.url}`);

    return records;
  }
}

// Created on first use, not on import: missing Cloudflare credentials must only
// fail crawl jobs, not stop every worker from starting.
let crawlerInstance: CloudflareCrawler | null = null;

export function getCloudflareCrawler(): CloudflareCrawler {
  crawlerInstance ??= new CloudflareCrawler();
  return crawlerInstance;
}
