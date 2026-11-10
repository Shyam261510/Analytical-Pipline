export type InstagramScraperErrorKind =
  | "INPUT"
  | "NETWORK"
  | "AUTH"
  | "RATE_LIMIT"
  | "HTTP"
  | "PARSE";

export class InstagramScraperError extends Error {
  constructor(
    public readonly kind: InstagramScraperErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "InstagramScraperError";
  }
}

export function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}
