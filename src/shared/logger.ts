type LogLevel = "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

// One JSON object per line, so worker logs can be filtered by username, queue or jobId.
function write(level: LogLevel, msg: string, context: LogContext) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...context,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export interface Logger {
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
  /** Returns a logger that adds `context` to every line. */
  child(context: LogContext): Logger;
}

function createLogger(base: LogContext = {}): Logger {
  return {
    info: (msg, context = {}) => write("info", msg, { ...base, ...context }),
    warn: (msg, context = {}) => write("warn", msg, { ...base, ...context }),
    error: (msg, context = {}) => write("error", msg, { ...base, ...context }),
    child: (context) => createLogger({ ...base, ...context }),
  };
}

export const logger = createLogger();

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
