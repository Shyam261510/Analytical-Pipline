import { handleAsync } from "../../../shared/handleAsync";
import { mkdir, rename, writeFile } from "fs/promises";
import { retryFailed } from "../../../shared/retryFailed";
import { errorMessage } from "../../../shared/utils";
import path from "node:path";

export class DownloadVideoService {
  // Max download attempts per reel video (passed to retryFailed)
  private readonly DOWNLOAD_MAX_ATTEMPTS = 3;
  // Per-attempt timeout for fetching a reel video
  private readonly DOWNLOAD_TIMEOUT_MS = 60_000;
  async convertURlToVideo(
    url: string,
    filePath: string,
  ): Promise<ServiceResult<string>> {
    return handleAsync(
      async () => {
        if (!url || !filePath) {
          throw new Error("URL and filePath are required");
        }

        // Ensure folder exists
        await mkdir(path.dirname(filePath), { recursive: true });

        // The CDN sometimes resets the socket mid-body (ECONNRESET); those are worth retrying.
        let lastError = "";
        const { succeeded } = await retryFailed(
          [filePath],
          async (target) => {
            try {
              return await this.downloadToFile(url, target);
            } catch (error: unknown) {
              lastError = errorMessage(error);
              throw error;
            }
          },
          this.DOWNLOAD_MAX_ATTEMPTS,
        );

        const saved = succeeded[0];
        if (!saved) {
          throw new Error(`Failed to download reel: ${lastError}`);
        }

        console.log("✅ Reel saved at:", saved);
        return saved;
      },
      `Error in downloading reel to ${path.basename(filePath)}`,
    );
  }
  // Single download attempt: fetch the video and write it atomically. Throws on failure.
  private async downloadToFile(url: string, filePath: string) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch reel URL (status: ${response.status})`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error("Reel URL returned an empty body");
    }

    // Write to a temp file, then rename: a crash mid-write never leaves half a video.
    const temp = `${filePath}.${process.pid}.tmp`;
    await writeFile(temp, buffer);
    await rename(temp, filePath);

    return filePath;
  }
}
