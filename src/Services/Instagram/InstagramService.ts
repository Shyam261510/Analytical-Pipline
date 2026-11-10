import { handleAsync } from "../../shared/handleAsync";
import { ScrapeDoService } from "../../shared/ScrapeDoService";
import { type ProfileData } from "../Profile/type.profile";
import { type ReelCodeInfo, type ReelMetadata } from "../Reel/type.reel";

/* ───────────────────────────── constants ───────────────────────────── */

const IG = "https://www.instagram.com";
const APP_ID = "936619743392459";
const DETAIL_DOC_ID = "27128499623469141";
// Reels-tab list query. Instagram changes these; this one currently returns
// "missing_required_variable_value" with the new variables, so put the doc_id
// that matches them here (copy it from DevTools > Network on /<user>/reels/).
const REELS_TAB_DOC_ID = "27420265870989234";
const REELS_TAB_NAME =
  "PolarisLoggedOutDesktopWWWProfileReelsTabContentQuery_connection";

const TOKEN_TTL_MS = 60 * 60 * 1000;
const DETAIL_CONCURRENCY = 3;
const MAX_RETRIES = 2;

const NAV_HEADERS = {
  "sd-accept": "text/html",
  "sd-sec-fetch-dest": "document",
  "sd-sec-fetch-mode": "navigate",
  "sd-sec-fetch-site": "none",
};

const LSD_RE = /"LSD",\[\],\{[^{}]*"token":"([^"]+)"/;
const AV_RE = /"IG_USER_EIMU":"?(\d+)/;
const JSON_BLOCK_RE = /<script type="application\/json"[^>]*>(.*?)<\/script>/gs;

/* ───────────────────────────── types ───────────────────────────── */

export type AccountResult = {
  profile: ProfileData;
  reel_codes: string[];
  reels: ReelMetadata[];
  errors: Record<string, string>;
};

type PageTokens = { lsd: string; av: string; at: number };
type AnyObj = Record<string, any>;

/* ───────────────────────────── service ───────────────────────────── */

export class InstagramService {
  private readonly scrapeDo = new ScrapeDoService();

  private tokenCache: PageTokens | null = null;
  private tokenInflight: Promise<PageTokens> | null = null;

  /* ───────────── public entry point ───────────── */

  /** Username in -> profile + the most recent `limit` reels out. No login, no cookies. */
  public async scrapeAccount(
    username: string,
    limit = 12,
  ): Promise<ServiceResult<AccountResult>> {
    return handleAsync(async () => {
      const name = username.trim().replace(/^@/, "");
      const { profile, posts } = this.unwrap(
        await this.getProfileAndPosts(name),
      );

      // 1) Reel codes already embedded in the profile page (no extra request).
      const codes = [
        ...new Set(posts.filter(this.isReel).map((p) => p["code"] as string)),
      ];

      // 2) The page only embeds ~12 recent posts, so top up from the reels tab if needed.
      if (codes.length < limit) {
        try {
          const tabCodes = this.unwrap(
            await this.getReelCodesFromTab(profile.id, name, limit),
          );
          for (const c of tabCodes) {
            if (!codes.includes(c)) codes.push(c);
          }
        } catch (err) {
          console.warn(
            `[ig] reels-tab fallback failed (${err instanceof Error ? err.message : err}); ` +
              `using ${codes.length} codes from the page`,
          );
        }
      }
      const reelCodes = codes.slice(0, limit);

      // 3) One detail call per reel, a few at a time.
      const settled = this.unwrap(
        await this.mapLimit(reelCodes, DETAIL_CONCURRENCY, async (c) =>
          this.unwrap(await this.getReelMeta(c)),
        ),
      );
      const reels: ReelMetadata[] = [];
      const errors: Record<string, string> = {};
      settled.forEach((r, i) => {
        const code = reelCodes[i] as string;
        if (r.status === "fulfilled") reels.push(r.value);
        else
          errors[code] =
            r.reason instanceof Error ? r.reason.message : String(r.reason);
      });

      return { profile, reel_codes: reelCodes, reels, errors };
    }, `scrapeAccount ${username}`);
  }

  /** Fetches the profile and the latest reel codes (top 12) from the profile's Reels tab. */
  public async handleExtractReelCode(
    username: string,
  ): Promise<ServiceResult<ReelCodeInfo & { profile: ProfileData }>> {
    return handleAsync(async () => {
      // Profile is needed for the numeric user id
      const { profile } = this.unwrap(await this.getProfileAndPosts(username));

      // GraphQL request body for the profile's Reels tab
      const fbDtsg = process.env.FB_DTSG;
      if (!fbDtsg) {
        throw new Error("FB_DTSG is not set in .env");
      }

      const body = new URLSearchParams({
        fb_dtsg: fbDtsg,
        doc_id: "29109455938671025",
        variables: JSON.stringify({
          data: {
            include_feed_video: true,
            page_size: 12,
            target_user_id: profile.id,
          },
          user_id: profile.id,
          __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: true,
        }),
      });

      // No session cookie on purpose: sending the logged-in cookie through
      // scrape.do makes Instagram answer with its HTML shell instead of JSON,
      // while the same request without it returns the reels JSON.
      const response = await this.scrapeDo.callPost<any>({
        url: `${IG}/api/graphql`,
        body,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      if (!response.success) {
        throw new Error(response.message);
      }

      // Validate the response shape before reading reel edges
      const conn = response.data?.data?.fetch__XDTUserDict?.clips_connection;
      if (!conn || !Array.isArray(conn.edges)) {
        throw new Error(
          `Failed to extract reel codes for username: ${username}. Invalid or unexpected Instagram response.`,
        );
      }

      // Keep only edges that have a valid string reel code
      const codes: string[] = conn.edges
        .map(
          (edge: { node?: { media?: { code?: string } } }) =>
            edge.node?.media?.code,
        )
        .filter((code: unknown): code is string => typeof code === "string");

      const reelCodes = codes.slice(0, 12);
      console.log(
        `[INFO] [Instagram Service] Successfully fetched ${reelCodes.length} reels for @${username}.`,
      );

      return { username, reel_codes: reelCodes, profile };
    }, `Error in EXTRACTING top 12 Reel Code of ${username}`);
  }

  /* ───────────── protected members ───────────── */

  protected async getProfileAndPosts(
    username: string,
  ): Promise<ServiceResult<{ profile: ProfileData; posts: AnyObj[] }>> {
    return handleAsync(async () => {
      const name = username.trim().replace(/^@/, "");
      if (!name) throw new Error("username is required");
      console.log(`Calling ${IG}/${name}`);
      const res = this.unwrap(
        await this.withRetry(async () => {
          const r = await this.scrapeDo.callGet<string>({
            url: `${IG}/${name}/`,
            headers: NAV_HEADERS,
          });
          if (!r.success) throw new Error(r.message);
          return r;
        }, `profile page ${name}`),
      );

      const html = String(res.data ?? "");
      const { user, posts } = this.parseProfilePage(html);
    
      if (!(user.pk ?? user.id) || !user.username) {
        throw new Error(
          `no profile data for "${name}" (account missing/private, or Instagram blocked the request)`,
        );
      }
      return { profile: this.mapProfile(user), posts };
    }, `getProfileAndPosts ${username}`);
  }

  async getReelMeta(code: string): Promise<ServiceResult<ReelMetadata>> {
    return handleAsync(async () => {
      const run = async () => {
        const data = this.unwrap(
          await this.graphql(
            DETAIL_DOC_ID,
            {
              shortcode: code,
              __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
            },
            `${IG}/reel/${code}/`,
          ),
        );
        const item =
          data?.data?.xdt_api__v1__media__shortcode__web_info?.items?.[0];
        if (!item) throw new Error("no item in detail response");
        return this.mapReel(item);
      };

      try {
        return this.unwrap(await this.withRetry(run, `reel ${code}`));
      } catch (err) {
        // Tokens may have gone stale: refresh once and try again.
        this.invalidatePageTokens();
        return this.unwrap(
          await this.withRetry(run, `reel ${code} (after token refresh)`),
        );
      }
    }, `getReelMeta ${code}`);
  }

  /* ───────────── private members ───────────── */

  private readonly sleep = (ms: number) =>
    new Promise((r) => setTimeout(r, ms));

  private readonly isReel = (p: AnyObj) => p["product_type"] === "clips";

  /** Calls `visit` for every object in a parsed JSON tree. */
  private walk(node: unknown, visit: (o: AnyObj) => void): void {
    if (Array.isArray(node)) {
      for (const n of node) this.walk(n, visit);
    } else if (node && typeof node === "object") {
      visit(node as AnyObj);
      for (const v of Object.values(node as AnyObj)) this.walk(v, visit);
    }
  }

  /** Turns a failed ServiceResult back into a thrown Error (for internal composition). */
  private unwrap<T>(result: ServiceResult<T>): T {
    if (!result.success) throw new Error(result.message);
    return result.data;
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    label: string,
  ): Promise<ServiceResult<T>> {
    return handleAsync(async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          return await fn();
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          // 404 is billed and permanent: do not retry it.
          if (/status code 404\b/.test(msg) || attempt === MAX_RETRIES) break;
          await this.sleep(1000 * 2 ** attempt);
        }
      }
      throw new Error(
        `${label}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
      );
    }, `withRetry ${label}`);
  }

  private invalidatePageTokens(): void {
    this.tokenCache = null;
  }

  /** lsd + av from the start page. One call, shared by every request until the TTL expires. */
  private async getPageTokens(): Promise<ServiceResult<PageTokens>> {
    return handleAsync(async () => {
      if (this.tokenCache && Date.now() - this.tokenCache.at < TOKEN_TTL_MS)
        return this.tokenCache;
      if (this.tokenInflight) return this.tokenInflight; // concurrent callers share one request

      this.tokenInflight = (async () => {
        const res = this.unwrap(
          await this.withRetry(async () => {
            const r = await this.scrapeDo.callGet<string>({
              url: `${IG}/`,
              headers: NAV_HEADERS,
            });
            if (!r.success) throw new Error(r.message);
            return r;
          }, "start page"),
        );

        const html = String(res.data ?? "");
        const lsd = LSD_RE.exec(html)?.[1];
        const av = AV_RE.exec(html)?.[1];
        if (!lsd || !av) throw new Error("start page had no lsd/av token");
        this.tokenCache = { lsd, av, at: Date.now() };
        return this.tokenCache;
      })();

      try {
        return await this.tokenInflight;
      } finally {
        this.tokenInflight = null;
      }
    }, "getPageTokens");
  }

  private parseProfilePage(html: string): { user: AnyObj; posts: AnyObj[] } {
    const user: AnyObj = {};
    const posts: AnyObj[] = [];
    const seen = new Set<string>();

    for (const m of html.matchAll(JSON_BLOCK_RE)) {
      const raw = m[1];
      if (!raw) continue;
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      this.walk(data, (o) => {
        const u = o["xig_user_by_username"];
        if (u && typeof u === "object" && !Array.isArray(u))
          Object.assign(user, u);
        if (
          typeof o["code"] === "string" &&
          "product_type" in o &&
          !seen.has(o["code"])
        ) {
          seen.add(o["code"]);
          posts.push(o);
        }
      });
    }
    return { user, posts };
  }

  private mapProfile(u: AnyObj): ProfileData {
    const p: ProfileData = {
      // `pk` is the classic numeric id (e.g. 80817130222); `id` is a longer global id.
      id: String(u.pk ?? u.id),
      username: u.username,
      bio_links: (u.bio_links ?? [])
        .map((l: AnyObj) => l?.url)
        .filter((x: unknown): x is string => typeof x === "string" && x !== ""),
    };
    if (u.full_name !== undefined) p.fullName = u.full_name;
    if (u.biography !== undefined) p.biography = u.biography;

    const followers = u.follower_count ?? u.edge_followed_by?.count;
    if (followers != null) p.followerCount = followers;
    const following = u.following_count ?? u.edge_follow?.count;
    if (following != null) p.followingCount = following;
    const posts =
      u.media_count ??
      u.all_media_count ??
      u.edge_owner_to_timeline_media?.count;
    if (posts != null) p.postsCount = posts;

    if (u.is_private !== undefined) p.isPrivate = u.is_private;
    if (u.is_verified !== undefined) p.isVerified = u.is_verified;
    const business = u.is_business_account ?? u.is_business;
    if (typeof business === "boolean") p.isBusinessAccount = business;
    if (typeof u.is_professional_account === "boolean")
      p.isProfessionalAccount = u.is_professional_account;
    const category = u.category_name ?? u.category;
    if (category) p.categoryName = category;
    if (u.external_url) p.externalUrl = u.external_url;
    if (u.profile_pic_url !== undefined) p.profilePicUrl = u.profile_pic_url;
    const hd = u.profile_pic_url_hd ?? u.hd_profile_pic_url_info?.url;
    if (hd) p.profilePicUrlHd = hd;
    const fbid = u.fbid ?? u.fbid_v2;
    if (fbid) p.fbid = fbid;
    return p;
  }

  private async graphql(
    docId: string,
    variables: AnyObj,
    referer: string,
    extra: Record<string, string> = {},
  ): Promise<ServiceResult<AnyObj>> {
    return handleAsync(async () => {
      const { lsd, av } = this.unwrap(await this.getPageTokens());
      const body = new URLSearchParams({
        doc_id: docId,
        variables: JSON.stringify(variables),
        server_timestamps: "true",
        lsd,
        av,
        ...extra,
      });

      const res = await this.scrapeDo.callPost<AnyObj>({
        url: `${IG}/api/graphql`,
        body,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "sd-x-ig-app-id": APP_ID,
          "sd-x-fb-lsd": lsd,
          "sd-x-requested-with": "XMLHttpRequest",
          "sd-referer": referer,
          "sd-sec-fetch-dest": "empty",
          "sd-sec-fetch-mode": "cors",
          "sd-sec-fetch-site": "same-origin",
        },
      });
      if (!res.success) throw new Error(res.message);
      const data = res.data;
      if (data?.errors?.length && !data?.data) {
        throw new Error(
          `GraphQL error: ${data.errors[0]?.message ?? "unknown"}`,
        );
      }
      return data;
    }, `graphql ${docId}`);
  }

  private async getReelCodesFromTab(
    userId: string,
    username: string,
    limit: number,
  ): Promise<ServiceResult<string[]>> {
    return handleAsync(async () => {
      const data = this.unwrap(
        await this.graphql(
          REELS_TAB_DOC_ID,
          {
            data: {
              include_feed_video: true,
              page_size: limit,
              target_user_id: userId,
            },
            user_id: userId,
            __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: true,
          },
          `${IG}/${username}/reels/`,
          { fb_api_req_friendly_name: REELS_TAB_NAME },
        ),
      );
      const codes: string[] = [];
      this.walk(data, (o) => {
        if (typeof o["code"] === "string" && "product_type" in o)
          codes.push(o["code"]);
      });
      return codes;
    }, `getReelCodesFromTab ${username}`);
  }

  private mapReel(item: AnyObj): ReelMetadata {
    const owner = item.user ?? item.owner ?? {};
    const caption = item.caption;
    return {
      code: item.code,
      pk: String(item.pk),
      id: String(item.id ?? item.pk),
      username: owner.username,
      ig_play_count: item.ig_play_count ?? null,
      play_count: item.play_count ?? null,
      fb_play_count: item.fb_play_count ?? null,
      like_count: item.like_count ?? null,
      comment_count: item.comment_count ?? null,
      media_repost_count: item.media_repost_count ?? null,
      taken_at: item.taken_at ?? null,
      video_duration: item.video_duration ?? null,
      video_url: item.video_versions?.[0]?.url ?? item.video_url ?? null,
      caption: typeof caption === "string" ? caption : (caption?.text ?? null),
    };
  }

  /** Runs `fn` over `items` with at most `limit` in flight; never rejects. */
  private async mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ): Promise<ServiceResult<PromiseSettledResult<R>[]>> {
    return handleAsync(async () => {
      const results: PromiseSettledResult<R>[] = new Array(items.length);
      let next = 0;
      const worker = async () => {
        while (next < items.length) {
          const i = next++;
          try {
            results[i] = {
              status: "fulfilled",
              value: await fn(items[i] as T),
            };
          } catch (reason) {
            results[i] = { status: "rejected", reason };
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, worker),
      );
      return results;
    }, "mapLimit");
  }
}
