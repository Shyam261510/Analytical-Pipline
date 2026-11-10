import { generateVariant, randomizeLastTwoDigits } from "./utils";

// Reads a required Instagram credential from .env with a clear error if it is missing.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env`);
  return value;
}

// Session cookie shared by every service that calls Instagram.
// Values are slightly varied on each call, like the previous per-class cookie.
export function createIgCookie(): string {
  const dsUserId = randomizeLastTwoDigits(Number(requireEnv("IG_DS_USER_ID")));
  const sessionId = `${dsUserId}${generateVariant(requireEnv("IG_SESSION_ID"))}`;
  const csrfToken = generateVariant(requireEnv("IG_CSRF_TOKEN"));

  return `sessionid=${sessionId}; csrftoken=${csrfToken}; ds_user_id=${dsUserId}`;
}
