export type ReelCodeInfo = {
  username: string;
  reel_codes: string[];
};
export type ReelMetadata = {
  code: string;
  pk: string;
  id: string;
  username: string | undefined;
  ig_play_count: number;
  play_count: number;
  fb_play_count: number;
  like_count: number;
  comment_count: number;
  media_repost_count: number;
  taken_at: number;
  video_duration: number;
  video_url: string | null;
  caption: string | null;
};

export type TranscriptSegment = {
  start: number; // seconds from the start of the video
  end: number;
  text: string;
};
export type WordTiming = { text: string; start: number; end: number };
