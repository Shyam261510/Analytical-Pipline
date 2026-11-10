export const connection = {
  host: process.env.REDIS_HOST!,
  port: parseInt(process.env.REDIS_PORT! ?? "6379"),
};

export const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: true,
  removeOnFail: true,
};

export const queueNames = {
  scrapeReelMeta: "scrape-reel-meta",
  downloadReel: "download-reel",
  audioExtract: "audio-extract",
  transcribeAudio: "transcribe-audio",
  bioAnalysis: "bio-analysis",
  linkResolve: "link-resolve",
  externalUrlCrawl: "external-url-crawl",
  profileAnalysis: "profile-analysis",
};
