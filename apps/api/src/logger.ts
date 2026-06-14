/**
 * Structured logging for the Worker.
 *
 * Every log line is a single JSON object written to the console, which is what
 * Cloudflare's log stream and most aggregators expect. A logger carries a base
 * context (such as a request id and route) that is merged into every line, and
 * `child` derives a new logger with extra context. Provider error detail is
 * logged, but API keys are scrubbed first so they never leak into logs.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Arbitrary structured fields attached to a log line. */
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Derive a logger that merges the given context into every line. */
  child(context: LogContext): Logger;
}

export interface LoggerOptions {
  /** Minimum level to emit. Defaults to "info". */
  minLevel?: LogLevel;
  /** Sink for finished lines. Defaults to console. Injectable for tests. */
  sink?: (level: LogLevel, line: string) => void;
  /** Clock, injectable for deterministic tests. */
  now?: () => number;
}

const SECRET_KEY_PATTERN = /(key|token|secret|authorization|password|apikey)/i;

/** Mask a Google style `key=...` query parameter inside any string. */
function redactKeyInString(value: string): string {
  return value.replace(/([?&](?:key|api_?key|token)=)[^&\s]+/gi, "$1[redacted]");
}

/**
 * Recursively redact secrets from a value before it is logged: object keys that
 * look sensitive are masked, and key like query parameters in strings are
 * scrubbed. Bounded in depth to avoid pathological inputs.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return "[truncated]";
  }
  if (typeof value === "string") {
    return redactKeyInString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redact(val, depth + 1);
    }
    return out;
  }
  return value;
}

function defaultSink(level: LogLevel, line: string): void {
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

class JsonLogger implements Logger {
  constructor(
    private readonly base: LogContext,
    private readonly minRank: number,
    private readonly sink: (level: LogLevel, line: string) => void,
    private readonly now: () => number,
  ) {}

  private emit(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_RANK[level] < this.minRank) {
      return;
    }
    const merged = { ...this.base, ...context };
    const line = {
      level,
      time: new Date(this.now()).toISOString(),
      msg: message,
      ...(redact(merged) as LogContext),
    };
    this.sink(level, JSON.stringify(line));
  }

  debug(message: string, context?: LogContext): void {
    this.emit("debug", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.emit("info", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.emit("warn", message, context);
  }

  error(message: string, context?: LogContext): void {
    this.emit("error", message, context);
  }

  child(context: LogContext): Logger {
    return new JsonLogger({ ...this.base, ...context }, this.minRank, this.sink, this.now);
  }
}

/** Create a structured logger. */
export function createLogger(base: LogContext = {}, options: LoggerOptions = {}): Logger {
  return new JsonLogger(
    base,
    LEVEL_RANK[options.minLevel ?? "info"],
    options.sink ?? defaultSink,
    options.now ?? Date.now,
  );
}

/**
 * Run an async stage, logging when it starts and finishes with the elapsed
 * milliseconds, and logging plus rethrowing on failure. Use it to wrap each
 * provider call so timing and errors are observable per stage.
 */
export async function timed<T>(
  logger: Logger,
  stage: string,
  fn: () => Promise<T>,
  context?: LogContext,
): Promise<T> {
  const start = Date.now();
  logger.debug(`${stage} started`, { stage, ...context });
  try {
    const result = await fn();
    logger.info(`${stage} ok`, { stage, durationMs: Date.now() - start, ...context });
    return result;
  } catch (error) {
    logger.error(`${stage} failed`, {
      stage,
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
      ...context,
    });
    throw error;
  }
}
