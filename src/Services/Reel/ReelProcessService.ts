import { chunkArray } from "../../shared/chunkArray";
import { retryFailed } from "../../shared/retryFailed";
import { ReelProcessingHelperService } from "./ReelProcessingHelperService";
import { queues } from "../../queue/defination";
import { queueNames } from "../../queue/config";

export class ReelProcessingService extends ReelProcessingHelperService {
  constructor() {
    super();
  }

  async scrapeReelCodes(usernames: string[]) {
    const usernameBatches = chunkArray(usernames, 3);

    for (const usernameBatch of usernameBatches) {
      const { succeeded: successfulScrapes } = await retryFailed(
        usernameBatch,
        (username) => this.handleExtractReelCode(username),
      );

      // One job per reel, so a failure retries only that reel.
      const metaJobs = successfulScrapes.flatMap((scrapeResult) =>
        scrapeResult.success
          ? scrapeResult.data.reel_codes.map((reelCode) => ({
              name: queueNames.scrapeReelMeta,
              data: {
                username: scrapeResult.data.username,
                reelCode,
              },
              opts: { jobId: `meta-${reelCode}` },
            }))
          : [],
      );

      if (metaJobs.length) {
        await queues.scrapeReelMetaQueue.addBulk(metaJobs);
      }
    }
  }
}
