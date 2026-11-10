// Offsets arrive as strings such as "0.100s".
export function parseOffsetSeconds(offset: unknown): number {
  return typeof offset === "string" ? parseFloat(offset) : NaN;
}
