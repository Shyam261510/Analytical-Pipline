import { randomInt } from "node:crypto";

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const URL_SAFE = ALNUM + "_-";
export function generateVariant(input: string): string {
  if (input.length < 6) {
    throw new Error("Input must contain at least 6 characters");
  }

  let suffix = "";

  for (let i = 0; i < 6; i++) {
    suffix += ALNUM[Math.floor(Math.random() * ALNUM.length)];
  }

  return input.slice(0, -6) + suffix;
}

export function randomizeLastTwoDigits(originalValue: number): number {
  const valueString = originalValue.toString();

  // Generate six random digits (0-9) as a string
  let replacementDigits = "";
  for (let i = 0; i < 6; i++) {
    replacementDigits += Math.floor(Math.random() * 10).toString();
  }

  // Keep everything except the last 6 characters, then append the new digits
  const modifiedString = valueString.slice(0, -6) + replacementDigits;

  // Convert back to a number
  return Number(modifiedString);
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
