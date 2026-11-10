import fs from "node:fs";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { handleAsync } from "../../../shared/handleAsync";

export class AudioExtractionService {
  // Extracts a mono 16 kHz MP3 from a video and returns the audio file path
  async extractAudio(
    videoPath: string,
    outputFolder: string,
    metadata?: ffmpeg.FfprobeData,
  ): Promise<ServiceResult<string>> {
    return handleAsync(
      async () => {
        // 1. Check whether the video contains an audio stream
        const metaData = metadata ?? (await this.probeVideo(videoPath));
        const hasAudio = metaData.streams.some(
          (stream) => stream.codec_type === "audio",
        );
        if (!hasAudio) {
          throw new Error("No audio stream found in video");
        }

        // 2. Prepare output folder; never write over the input
        fs.mkdirSync(outputFolder, { recursive: true });
        const audioPath = path.join(
          outputFolder,
          `${path.parse(videoPath).name}.mp3`,
        );
        if (path.resolve(audioPath) === path.resolve(videoPath)) {
          throw new Error("Refusing to overwrite the input video");
        }
        // ffmpeg writes here first, so an interrupted run never leaves a partial .mp3
        const tempAudioPath = path.join(
          outputFolder,
          `${path.parse(videoPath).name}.${process.pid}.tmp.mp3`,
        );

        // 3. Extract audio as mono, 16 kHz, 64 kbps MP3
        await new Promise<void>((resolve, reject) => {
          ffmpeg(videoPath)
            .noVideo()
            .audioCodec("libmp3lame")
            .audioChannels(1)
            .audioFrequency(16000)
            .audioBitrate("64k")
            .output(tempAudioPath)
            .on("end", () => resolve())
            .on("error", (err: Error) =>
              reject(new Error(`Audio extraction failed: ${err.message}`)),
            )
            .run();
        });

        // 4. Verify that the output file exists and is not empty
        if (
          !fs.existsSync(tempAudioPath) ||
          fs.statSync(tempAudioPath).size === 0
        ) {
          throw new Error("ffmpeg produced no audio file");
        }
        fs.renameSync(tempAudioPath, audioPath);

        return audioPath;
      },
      `Error in extracting audio from ${path.basename(videoPath)}`,
    );
  }

  private probeVideo(videoPath: string): Promise<ffmpeg.FfprobeData> {
    if (!fs.existsSync(videoPath)) {
      return Promise.reject(new Error(`Video file not found: ${videoPath}`));
    }
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err)
          return reject(
            new Error(
              `ffprobe cannot read ${path.basename(videoPath)}: ${err.message}`,
            ),
          );
        resolve(metadata);
      });
    });
  }
}
