import { Queue } from "bullmq";
import { connection, defaultJobOptions, queueNames } from "./config";
import type {
  DownloadReelJob,
  ExtractAudioJob,
  ScrapeReelMetaJob,
  TranscibeAudioJob,
  CrawlUrlJob,
} from "./types";

export const queues = {
  scrapeReelMetaQueue: new Queue<ScrapeReelMetaJob>(queueNames.scrapeReelMeta, {
    connection,
    defaultJobOptions,
  }),
  downloadReelQueue: new Queue<DownloadReelJob>(queueNames.downloadReel, {
    connection,
    defaultJobOptions,
  }),
  audioExtractQueue: new Queue<ExtractAudioJob>(queueNames.audioExtract, {
    connection,
    defaultJobOptions,
  }),
  transcribeAudioQueue: new Queue<TranscibeAudioJob>(
    queueNames.transcribeAudio,
    {
      connection,
      defaultJobOptions,
    },
  ),

  crawlUrlQueue: new Queue<CrawlUrlJob>(queueNames.externalUrlCrawl, {
    connection,
    defaultJobOptions,
  }),
};
