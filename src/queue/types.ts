export type ScrapeReelMetaJob = {
  username: string;
  reelCode: string;
};

export type DownloadReelJob = {
  username: string;
  reelCode: string;

  reelUrl: string;
};

export type ExtractAudioJob = {
  username: string;
  reelCode: string;
  videoPath: string;
};

export type TranscibeAudioJob = {
  username: string;
  reelCode: string;
  audioPath: string;
};

export type CrawlUrlJob = {
  username: string;
  urls: string[];
};
