import { Worker, type Job, type WorkerOptions } from "bullmq";
import { connection } from "./config";
import { queueNames } from "./config";
import { ReelProcessor } from "../Services/Reel/Processor/ReelProcessor";
import { logger } from "../shared/logger";
import { CrawlUrlProcessor } from "../Services/Crawl/Processor/CrawlUrlProcessor";

interface WorkerConfig {
  queueName: string;
  processor: (job: any) => Promise<any>;
  concurrency?: number;
  // Runs once a job has used up all its retries.
  onFinalFailure?: (job: Job, error: string) => Promise<void>;
}

const reelProcessors = new ReelProcessor();
const crawlUrlProcessor = new CrawlUrlProcessor();

const markReelFailed = (job: Job, error: string) =>
  reelProcessors.markReelFailed(job.data.username, job.data.reelCode, error);

const workerConfig: WorkerConfig[] = [
  {
    queueName: queueNames.scrapeReelMeta,
    processor: reelProcessors.scrapeReelMetaProcessor.bind(reelProcessors),
    // Each job is one scrape.do call, so this caps calls in flight.
    concurrency: 1,
    onFinalFailure: markReelFailed,
  },
  {
    queueName: queueNames.downloadReel,
    processor: reelProcessors.downloadReelProcessor.bind(reelProcessors),
    concurrency: 4,
    onFinalFailure: markReelFailed,
  },
  {
    queueName: queueNames.audioExtract,
    processor: reelProcessors.extractAudioProcessor.bind(reelProcessors),
    concurrency: 4,
    onFinalFailure: markReelFailed,
  },
  {
    queueName: queueNames.transcribeAudio,

    processor:
      reelProcessors.transcribeLocalAudioProcessor.bind(reelProcessors),
    concurrency: 1,
    onFinalFailure: markReelFailed,
  },

  {
    queueName: queueNames.externalUrlCrawl,
    processor: crawlUrlProcessor.crawlUrlsProcessor.bind(crawlUrlProcessor),
    concurrency: 1,
    // Not markReelFailed: crawl jobs have a username and urls, but no reelCode.
    onFinalFailure: (job, error) =>
      crawlUrlProcessor.markCrawlFailed(job, error),
  },
];
export function createWorkers() {
  const workers = workerConfig.map((config) => {
    const workerOptions: WorkerOptions = {
      connection,
      concurrency: config.concurrency || 5,
    };
    const worker = new Worker(
      config.queueName,
      config.processor,
      workerOptions,
    );
    console.log("worker created...");

    // Add event Listners
    worker.on("completed", (job) => {
      console.log(`✅ [${config.queueName}] Job ${job.id} completed`);
    });

    worker.on("failed", (job, error) => {
      console.error(
        `❌ [${config.queueName}] Job ${job?.id} failed:`,
        error.message,
      );

      if (
        job &&
        config.onFinalFailure &&
        job.attemptsMade >= (job.opts.attempts ?? 1)
      ) {
        config.onFinalFailure(job, error.message).catch((err) =>
          logger.error("final-failure handler failed", {
            queue: config.queueName,
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    });
    worker.on("error", (err) => {
      console.error(`🔥 [${config.queueName}] Worker error:`, err);
    });
    worker.on("active", (job) => {
      console.log(`⚙️  [${config.queueName}] Job ${job.id} started`);
    });
    console.log(`🔧 Worker created for queue: ${config.queueName}`);

    return worker;
  });

  return workers;
}
