import { ScrapeDoService } from "../../shared/ScrapeDoService";
import { log } from "./logger.ts";

import { InstagramScraperError, normalizeUsername } from "./utils.ts";
import type { ProfileData, RawPageProfileUser } from "./type.profile.ts";

const scrapeDoService = new ScrapeDoService();

// Matches each <script type="application/json"> block Instagram embeds in the
// profile page. The `s` flag lets `.` span newlines; non-greedy stops at the
// first closing tag (Instagram escapes any literal </script> inside the JSON).
const EMBEDDED_JSON_RE =
  /<script type="application\/json"[^>]*>(.*?)<\/script>/gs;

// The profile object lives under this key in one of the embedded JSON blocks.
const USER_CONTAINER_KEY = "xig_user_by_username";

/** Collects every object found at `key` anywhere in a parsed JSON tree. */
function collectByKey(
  node: unknown,
  key: string,
  out: Record<string, any>[],
): void {
  if (Array.isArray(node)) {
    for (const item of node) collectByKey(item, key, out);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const value = obj[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(value as Record<string, any>);
    }
    for (const child of Object.values(obj)) collectByKey(child, key, out);
  }
}

/**
 * Pulls the user object out of the profile page HTML. Instagram can split the
 * profile across several embedded blocks, so every `xig_user_by_username`
 * object is merged into one.
 */
function extractUserFromHtml(html: string): RawPageProfileUser | null {
  const merged: Record<string, any> = {};
  let found = false;

  for (const match of html.matchAll(EMBEDDED_JSON_RE)) {
    const raw = match[1];
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // not every embedded block is valid JSON we care about
    }
    const users: Record<string, any>[] = [];
    collectByKey(parsed, USER_CONTAINER_KEY, users);
    for (const user of users) {
      Object.assign(merged, user);
      found = true;
    }
  }

  return found ? (merged as RawPageProfileUser) : null;
}

/** Maps the raw embedded user object to our public ProfileData shape. */
function mapPageProfile(user: RawPageProfileUser): ProfileData {
  const profile: ProfileData = {
    // Prefer `pk` (the classic numeric id, e.g. 80817130222) over `id`, which in
    // the embedded page object is the longer global id. The reels endpoint's
    // `target_user_id` expects the `pk` form.
    id: (user.pk ?? user.id) as string,
    username: user.username,
    // A link can come back without a url.
    bio_links: (user.bio_links ?? [])
      .map((link) => link.url)
      .filter((url): url is string => Boolean(url)),
  };

  if (user.full_name !== undefined) profile.fullName = user.full_name;
  if (user.biography !== undefined) profile.biography = user.biography;

  // Instagram sends either the flat count or the older edge-shaped count.
  const followers = user.follower_count ?? user.edge_followed_by?.count;
  if (followers !== undefined) profile.followerCount = followers;
  const following = user.following_count ?? user.edge_follow?.count;
  if (following !== undefined) profile.followingCount = following;
  const posts =
    user.media_count ??
    user.all_media_count ??
    user.edge_owner_to_timeline_media?.count;
  if (posts !== undefined && posts !== null) profile.postsCount = posts;

  if (user.is_private !== undefined) profile.isPrivate = user.is_private;
  if (user.is_verified !== undefined) profile.isVerified = user.is_verified;
  const business = user.is_business_account ?? user.is_business;
  if (business !== undefined) profile.isBusinessAccount = business;
  // Instagram sends null for non-professional accounts; only keep real booleans.
  if (typeof user.is_professional_account === "boolean")
    profile.isProfessionalAccount = user.is_professional_account;
  const category = user.category_name ?? user.category;
  if (category) profile.categoryName = category;
  if (user.external_url) profile.externalUrl = user.external_url;
  if (user.profile_pic_url !== undefined)
    profile.profilePicUrl = user.profile_pic_url;
  const hdPic = user.profile_pic_url_hd ?? user.hd_profile_pic_url_info?.url;
  if (hdPic !== undefined) profile.profilePicUrlHd = hdPic;
  const fbid = user.fbid ?? user.fbid_v2;
  if (fbid !== undefined) profile.fbid = fbid;

  return profile;
}

/** Turns a scrape.do failure message into a typed scraper error. */
function toScraperError(message: string, username: string) {
  if (/status code (401|403)\b/.test(message)) {
    return new InstagramScraperError(
      "AUTH",
      `Instagram/scrape.do rejected the request for "${username}": ${message}`,
    );
  }
  if (/status code 429\b/.test(message)) {
    return new InstagramScraperError(
      "RATE_LIMIT",
      `scrape.do returned 429 — proxy/credit rate limit reached.`,
      429,
    );
  }
  if (/status code 404\b/.test(message)) {
    return new InstagramScraperError(
      "HTTP",
      `Instagram returned 404 for "${username}" — the account may not exist.`,
    );
  }
  if (/status code \d{3}\b/.test(message)) {
    return new InstagramScraperError(
      "HTTP",
      `scrape.do request failed for "${username}": ${message}`,
    );
  }
  return new InstagramScraperError(
    "NETWORK",
    `Failed to fetch profile for "${username}" via scrape.do: ${message}`,
  );
}

/**
 * Fetches Instagram profile info and returns it as a {@link ProfileData} object
 * (it does NOT write any file).
 *
 * This reads the public, logged-out profile page through the scrape.do proxy and
 * parses the profile data Instagram embeds in the page HTML. No Instagram login,
 * cookie, or FB_DTSG token is involved, so it works for any public account and
 * resolves the numeric id from the username alone. `profile.id` is the numeric
 * `ig_user_id` used as `target_user_id` when scraping the account's reels.
 *
 * @param username Public Instagram username (with or without a leading @).
 * @param _userId  Unused. Kept so existing callers that pass a known id still
 *                 compile; the id is now resolved from the page.
 */
export async function getProfile(
  username: string,
  _userId?: string,
): Promise<ProfileData> {
  const normalized = normalizeUsername(username ?? "");
  if (!normalized) {
    throw new InstagramScraperError("INPUT", "username is required.");
  }

  log.info(`Fetching profile for "${normalized}" via scrape.do…`);

  // Instagram only embeds the profile JSON when the request looks like a browser
  // page navigation, so forward those headers to the target ("sd-" prefix).
  const response = await scrapeDoService.callGet<string>({
    url: `https://www.instagram.com/${normalized}/`,
    headers: {
      "sd-accept": "text/html",
      "sd-sec-fetch-dest": "document",
      "sd-sec-fetch-mode": "navigate",
      "sd-sec-fetch-site": "none",
    },
  });

  if (!response.success) {
    throw toScraperError(response.message, normalized);
  }

  const html = response.data;
  if (typeof html !== "string" || !html.includes(USER_CONTAINER_KEY)) {
    throw new InstagramScraperError(
      "PARSE",
      `Profile page for "${normalized}" contained no profile data — the account may not exist, may be private, or scrape.do returned an unexpected body.`,
    );
  }

  const user = extractUserFromHtml(html);
  if (!user || !(user.id ?? user.pk) || !user.username) {
    throw new InstagramScraperError(
      "PARSE",
      `Could not parse the profile for "${normalized}" from the Instagram page.`,
    );
  }

  const profile = mapPageProfile(user);
  log.info(
    `Resolved @${profile.username} -> id ${profile.id}` +
      (profile.followerCount !== undefined
        ? ` (${profile.followerCount} followers, ${profile.followingCount ?? "?"} following).`
        : "."),
  );

  return profile;
}
