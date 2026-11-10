export const SCRAPE_DO_BASE_URL = "https://api.scrape.do/";
export const SCRAPE_DO_TOKEN = process.env.SCRAPE_DO_TOKEN;
// Max parallel scrape.do requests per process (free plan allows 5).
export const SCRAPE_DO_CONCURRENCY = parseInt(
  process.env.SCRAPE_DO_CONCURRENCY ?? "5",
);
// Max parallel video downloads / ffmpeg runs / transcriptions per process.
export const MEDIA_CONCURRENCY = parseInt(
  process.env.MEDIA_CONCURRENCY ?? "12",
);
export const WEB_PROFILE_INFO_URL =
  "https://www.instagram.com/api/v1/users/web_profile_info/";
export const REQUEST_TIMEOUT_MS = 60_000;
// Required for web_profile_info on anonymous requests; without it IG returns
// a schema-resolution error instead of profile data.
export const IG_APP_ID = "936619743392459";
