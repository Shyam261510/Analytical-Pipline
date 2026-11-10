import fs from "node:fs";
import path from "node:path";
import { GeminiProvider } from "../../../Provider/GeminiProvider";
import { handleAsync } from "../../../shared/handleAsync";
import type { TranscriptSegment, WordTiming } from "../type.reel";
import { parseOffsetSeconds } from "./utils";

const TRANSCRIBE_MODEL = "gemini-3.5-transcribe";
// BCP-47 codes; use [] to let Gemini auto-detect the language.
const TRANSCRIBE_LANGUAGES = ["en-US"];
// Gemini returns word timings; words are grouped into segments on these limits.
const SEGMENT_MAX_SECONDS = 8;
const SEGMENT_MAX_GAP_SECONDS = 0.8;

export class TranscribeAudioService {
  constructor() {
    // Fail clearly at startup instead of after uploading something that cannot succeed.
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is missing in .env");
    }
  }

  // Transcribes a local mp3 with Gemini; an empty array means no speech was detected
  async transcribeLocalAudio(
    filePath: string,
  ): Promise<ServiceResult<TranscriptSegment[]>> {
    return handleAsync(
      async () => {
        let uploadedName: string | undefined;
        const gemini = GeminiProvider.getInstance().client;

        try {
          if (!fs.existsSync(filePath)) {
            throw new Error("Audio file not found");
          }

          const audioFile = await gemini.files.upload({
            file: filePath,
            config: { mimeType: "audio/mp3" },
          });
          uploadedName = audioFile.name;

          // Word-level timestamps are the only timing Gemini returns, so segments are built from them.
          const interaction = await gemini.interactions.create({
            model: TRANSCRIBE_MODEL,
            input: [
              {
                type: "audio",
                uri: audioFile.uri!,
                mime_type: audioFile.mimeType!,
              },
            ],
            generation_config: {
              transcription_config: {
                language_codes: TRANSCRIBE_LANGUAGES,
                mode: { type: "verbatim", timestamp_granularities: ["word"] },
              },
            },
          } as any);

          const words = this.extractWords(interaction);

          // Debug: show where word times go backwards (remove once the cause is known)
          words.forEach((w, i) => {
            const prev = words[i - 1];
            if (prev && w.start < prev.start) {
              console.warn(
                `[transcribe] out-of-order word #${i}: "${prev.text}" ${prev.start}-${prev.end} -> "${w.text}" ${w.start}-${w.end}`,
              );
            }
          });

          // Gemini doesn't guarantee annotation order, so sort by time before grouping.
          words.sort((a, b) => a.start - b.start || a.end - b.end);

          const raw = words.length
            ? this.groupWordsIntoSegments(words)
            : this.fallbackSegments(interaction);

          // Validate before returning.
          return this.normalizeSegments(raw);
        } finally {
          // The upload is only needed for this call; Gemini also expires it on its own.
          if (uploadedName) {
            await gemini.files.delete({ name: uploadedName }).catch(() => {});
          }
        }
      },
      `Error in transcribing audio ${path.basename(filePath)}`,
    );
  }
  private groupWordsIntoSegments(
    words: WordTiming[],
  ): { start: number; end: number; text: string }[] {
    const segments: { start: number; end: number; text: string }[] = [];
    let current: WordTiming[] = [];

    const flush = () => {
      if (!current.length) return;
      segments.push({
        start: current[0]!.start,
        end: current[current.length - 1]!.end,
        text: current.map((w) => w.text).join(" "),
      });
      current = [];
    };

    for (const word of words) {
      const last = current[current.length - 1];
      if (
        last &&
        (word.start - last.end > SEGMENT_MAX_GAP_SECONDS ||
          word.end - current[0]!.start > SEGMENT_MAX_SECONDS)
      ) {
        flush();
      }
      current.push(word);
      if (/[.!?।]$/.test(word.text.trim())) flush();
    }
    flush();
    return segments;
  }
  // No word timings came back: keep the text as one segment rather than losing it.
  private fallbackSegments(
    interaction: any,
  ): { start: number; end: number; text: string }[] {
    const text = String(interaction.output_text ?? "").trim();
    return text ? [{ start: 0, end: 0, text }] : [];
  }
  private extractWords(interaction: any): WordTiming[] {
    const words: WordTiming[] = [];
    for (const step of interaction.steps ?? []) {
      for (const content of step.content ?? []) {
        for (const annotation of content.annotations ?? []) {
          if (annotation.type !== "word_info") continue;
          const start = parseOffsetSeconds(annotation.start_offset);
          const end = parseOffsetSeconds(annotation.end_offset);
          if (!Number.isFinite(start)) continue; // skip words with no usable time
          words.push({
            text: String(annotation.text ?? ""),
            start,
            end: Number.isFinite(end) && end >= start ? end : start, // never end before start
          });
        }
      }
    }
    return words;
  }
  private normalizeSegments(
    raw: { start: number; end: number; text: string }[],
  ): TranscriptSegment[] {
    const out: TranscriptSegment[] = [];
    let previousStart = -1;
    for (const segment of raw) {
      const text = segment.text.trim();
      if (!text) continue; // skip empty segments
      const { start, end } = segment;
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end < start
      ) {
        throw new Error(`Invalid segment times: ${start} → ${end}`);
      }
      if (start < previousStart) {
        throw new Error(`Segments went backwards at ${start}s`);
      }
      previousStart = start;
      out.push({
        start: Number(start.toFixed(3)),
        end: Number(end.toFixed(3)),
        text,
      });
    }
    return out;
  }
}
