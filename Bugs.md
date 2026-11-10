# Bugs: external URL crawl to markdown

Scope: `crawlUrlsToMarkdown` and `CrawlUrlProcessor`, plus the code they depend on or feed.

These come from reading the code on 2026-11-05. Nothing was run or reproduced.

| # | Severity | Bug |
|---|----------|-----|
| 1 | High | A failed crawl never fails the job, so it is never retried |
| 2 | High | The report can be written before the crawl finishes |
| 3 | High | A failed re-run overwrites good markdown with an empty string |
| 4 | High | Crawled markdown is not saved to a markdown file |
| 5 | Medium | Pages are joined with no source URL or separator |
| 6 | Medium | One shared status field is overwritten by every URL |
| 7 | Medium | One failed status poll abandons the URL |
| 8 | Medium | Missing Cloudflare credentials stop every worker from starting |
| 9 | Medium | Crawl failures leave no record |
| 10 | Low | No limit on concurrent crawls |
| 11 | Low | No size limit on the stored markdown |
| 12 | Low | URLs are not validated or normalised |
| 13 | Low | A Redis failure after a good crawl pays for the crawl again |
| 14 | Low | Record pagination has no upper bound |
| 15 | Low | `CRAWL_DEPTH` has little effect with `CRAWL_LIMIT = 2` |

## High

### 1. A failed crawl never fails the job, so it is never retried

**Where:** [CrawlMarkdownService.ts:49-53](src/Services/Crawl/CrawlMarkdownService.ts#L49-L53), [CrawlUrlProcessor.ts:22](src/Services/Crawl/Processor/CrawlUrlProcessor.ts#L22)

**What happens:** The per-URL `catch` swallows every error and returns `[]`, so `crawlUrlsToMarkdown` returns `success: true` even if every URL failed. The processor's `if (!result.success) throw` almost never fires, so the `attempts: 3` setting in [config.ts:7](src/queue/config.ts#L7) does nothing for crawl failures.

The real error (timeout, 401, 429) is also discarded without being logged.

**Fix:** Log each error with its URL. Throw when no URL produced markdown, so BullMQ retries.

### 2. The report can be written before the crawl finishes

**Where:** [ReelProcessingHelperService.ts:59](src/Services/Reel/ReelProcessingHelperService.ts#L59), [ReelProcessingHelperService.ts:210-211](src/Services/Reel/ReelProcessingHelperService.ts#L210-L211)

**What happens:** The crawl job is queued and nothing waits for it. The report is written once, when the 12th reel is transcribed, and it reads `externalMarkdown` at that moment. If the crawl is still queued or running, the report shows `N/A`, and it is never regenerated. The crawl runs at concurrency 1, so another user's crawl can delay it, and each URL can poll for up to 5 minutes.

**Fix:** Make the report wait until both the reels and the crawl are finished. For example, track both in Redis and have whichever finishes last write the report.

### 3. A failed re-run overwrites good markdown with an empty string

**Where:** [CrawlUrlProcessor.ts:24-28](src/Services/Crawl/Processor/CrawlUrlProcessor.ts#L24-L28)

**What happens:** Because of bug 1, a run where every URL fails still writes `externalMarkdown: ""`, replacing any markdown saved by an earlier successful run. The report's `show()` then prints `N/A`, which looks the same as a user with no links or a crawl that never ran.

**Fix:** Only write `externalMarkdown` when there is content. Record failure as a separate status.

### 4. Crawled markdown is not saved to a markdown file

**Where:** [CrawlUrlProcessor.ts:24-28](src/Services/Crawl/Processor/CrawlUrlProcessor.ts#L24-L28), [ReelReportService.ts:106-110](src/Services/Reel/helper/ReelReportService.ts#L106-L110)

**What happens:** The markdown is stored only in a Redis hash field, which expires after 6 hours, and copied into the `.txt` report. No `.md` file is ever written, so the markdown is lost if the key expires before the report runs.

**Fix:** Write it to a file such as `output/markdown/<username>.md`, or one file per URL, using the temp-file-then-rename approach `ReelReportService` already uses.

## Medium

### 5. Pages are joined with no source URL or separator

**Where:** [CrawlMarkdownService.ts:46-48](src/Services/Crawl/CrawlMarkdownService.ts#L46-L48), [CrawlMarkdownService.ts:57](src/Services/Crawl/CrawlMarkdownService.ts#L57)

**What happens:** `results.flat().join("\n")` merges every page into one block. `record.url` and the page title are dropped, so nobody can tell which text came from which link. A page's last line also runs straight into the next page's first line, which can break markdown such as lists and code fences.

**Fix:** Keep `record.url` and format each page like this:

```ts
`## ${record.url}\n\n${markdown}`
```

Join the pages with `"\n\n---\n\n"`.

### 6. One shared status field is overwritten by every URL

**Where:** [CrawlUrlProcessor.ts:18-20](src/Services/Crawl/Processor/CrawlUrlProcessor.ts#L18-L20), [CrawlMarkdownService.ts:43](src/Services/Crawl/CrawlMarkdownService.ts#L43)

**What happens:**

- The callback receives `(status, url)`, but the processor ignores `url`. URLs run in parallel, so the stored value is whichever URL reported last, and it does not describe the job as a whole.
- `done` can be stored before `externalMarkdown` exists, because the markdown is saved only after all URLs finish.
- A URL is marked `done` even when it returned no markdown.
- The field name is misspelled as `crawlStautus`. Nothing in `src` reads this field today, so none of this affects output yet. It will matter as soon as something depends on the status, which is what bug 2's fix needs.

**Fix:** Rename the field to `crawlStatus` and store one overall job status. If per-URL detail is needed, store it as a map. Set `done` only after the markdown is saved.

### 7. One failed status poll abandons the URL

**Where:** [CrawlService.ts:98-99](src/Services/Crawl/CrawlService.ts#L98-L99)

**What happens:** Any error from `getCrawlResult`, such as a brief 429 or a network timeout, immediately ends the wait for that URL. The Cloudflare crawl has already started and is never cancelled or checked again, so its result is lost. Because of bug 1, the job does not retry either.

**Fix:** Tolerate transient errors during polling, and give up only after several consecutive failures.

### 8. Missing Cloudflare credentials stop every worker from starting

**Where:** [CrawlService.ts:50-52](src/Services/Crawl/CrawlService.ts#L50-L52), [CrawlService.ts:158](src/Services/Crawl/CrawlService.ts#L158), [wrokers.ts:6](src/queue/wrokers.ts#L6)

**What happens:** `new CloudflareCrawler()` runs when the module is imported and throws if the env vars are missing. `wrokers.ts` imports it, so a missing crawl credential also takes down the reel download and transcription workers.

**Fix:** Create the client on first use, so only crawl jobs fail.

### 9. Crawl failures leave no record

**Where:** [wrokers.ts:51-56](src/queue/wrokers.ts#L51-L56), [config.ts:10](src/queue/config.ts#L10)

**What happens:** The crawl worker has no `onFinalFailure`, and `removeOnFail: true` deletes failed jobs. When a job runs out of retries, the status stays at its last value, such as `crawling`, and only a console line remains.

**Fix:** Add an `onFinalFailure` handler that writes the failure status and the error message to the profile hash.

## Low

### 10. No limit on concurrent crawls

**Where:** [CrawlMarkdownService.ts:34-35](src/Services/Crawl/CrawlMarkdownService.ts#L34-L35)

`Promise.all` starts a Cloudflare crawl for every URL at once, which risks rate limits on profiles with many bio links. Worker concurrency of 1 limits jobs, not the URLs inside a job. Use a small concurrency limit, like `mapLimit` in `InstagramService`.

### 11. No size limit on the stored markdown

**Where:** [CrawlUrlProcessor.ts:24-28](src/Services/Crawl/Processor/CrawlUrlProcessor.ts#L24-L28)

Whole pages go into one Redis field and then into the report, with no cap. Limit the size per page and in total, and mark where text was cut.

### 12. URLs are not validated or normalised

**Where:** [CrawlMarkdownService.ts:20](src/Services/Crawl/CrawlMarkdownService.ts#L20)

Bio links are untrusted input, and they are sent to the crawler as they are. There is no `http`/`https` check. De-duplication only removes exact string matches, so `https://a.com` and `https://a.com/` are both crawled. Parse each URL with `new URL()`, reject other schemes, and compare the normalised form.

### 13. A Redis failure after a good crawl pays for the crawl again

**Where:** [CrawlUrlProcessor.ts:24-28](src/Services/Crawl/Processor/CrawlUrlProcessor.ts#L24-L28)

If the final Redis write throws, BullMQ retries the job and crawls every URL again, discarding the markdown it already has. Retry the write on its own before failing the job.

### 14. Record pagination has no upper bound

**Where:** [CrawlService.ts:123-137](src/Services/Crawl/CrawlService.ts#L123-L137)

The `do...while (cursor)` loop stops only when the API returns no cursor. If the API keeps returning one, the loop never ends and holds the only crawl worker slot. This is a risk rather than an observed failure, and the cursor behaviour has not been checked against Cloudflare's documentation. Add a maximum page count.

### 15. `CRAWL_DEPTH` has little effect with `CRAWL_LIMIT = 2`

**Where:** [CrawlService.ts:39-40](src/Services/Crawl/CrawlService.ts#L39-L40)

If `limit` caps total pages per crawl, which has not been checked against Cloudflare's documentation, then only two pages are fetched and a depth of 3 can rarely be reached. Most of a site's content is also missed. Choose these values on purpose.
