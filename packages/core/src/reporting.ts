/**
 * A tiny, dependency free error reporting layer.
 *
 * It defines a small {@link ErrorReporter} interface that the API Worker and
 * the web app both use, plus a Sentry implementation that speaks Sentry's
 * envelope HTTP API directly via fetch. Keeping it dependency free means it
 * runs unchanged in a Cloudflare Worker and in the browser, and stays easy to
 * unit test by injecting a fetch stub.
 */

/** Severity of a reported event, mirroring Sentry's levels. */
export type ReportLevel = "fatal" | "error" | "warning" | "info" | "debug";

/** Extra context attached to a reported error. */
export interface ReportContext {
  /** Logical component, e.g. "api" or "web". */
  component?: string;
  /** Operation or pipeline stage where the error happened. */
  stage?: string;
  /** Searchable tags. */
  tags?: Record<string, string>;
  /** Arbitrary structured data. Secrets must be redacted before this point. */
  extra?: Record<string, unknown>;
  /** Severity. Defaults to "error". */
  level?: ReportLevel;
}

/** Anything that can capture an exception for later inspection. */
export interface ErrorReporter {
  /**
   * Report an error. Implementations must never throw: a failure to report is
   * swallowed so it cannot mask the original problem. The returned promise (if
   * any) resolves once the report has been flushed, which callers in a Worker
   * may await or hand to `ctx.waitUntil`.
   */
  captureException(error: unknown, context?: ReportContext): Promise<void> | void;
}

/** A reporter that does nothing. Used when no DSN is configured. */
export const noopReporter: ErrorReporter = {
  captureException() {
    /* intentionally empty */
  },
};

/** Parsed pieces of a Sentry DSN. */
export interface ParsedDsn {
  publicKey: string;
  host: string;
  protocol: string;
  projectId: string;
  /** Path prefix that precedes the project id, if any. */
  path: string;
  /** Fully built envelope ingest URL. */
  envelopeUrl: string;
}

/**
 * Parse a Sentry DSN such as `https://abc@o0.ingest.sentry.io/12345` into the
 * parts needed to build an envelope ingest URL. Returns null when the value is
 * not a usable DSN, so callers can fall back to a no op reporter.
 */
export function parseDsn(dsn: string): ParsedDsn | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }

  const publicKey = url.username;
  if (!publicKey) {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  if (!projectId) {
    return null;
  }

  const protocol = url.protocol.replace(/:$/, "");
  const host = url.host;
  const path = segments.join("/");
  const base = `${protocol}://${host}${path ? `/${path}` : ""}`;
  const envelopeUrl = `${base}/api/${projectId}/envelope/?sentry_key=${publicKey}&sentry_version=7`;

  return { publicKey, host, protocol, projectId, path, envelopeUrl };
}

interface SentryStackFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}

interface NormalizedError {
  name: string;
  message: string;
  stack?: string;
}

function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return { name: error.name || "Error", message: error.message, stack: error.stack };
  }
  if (typeof error === "string") {
    return { name: "Error", message: error };
  }
  try {
    return { name: "Error", message: JSON.stringify(error) };
  } catch {
    return { name: "Error", message: "Non serialisable error" };
  }
}

/**
 * Best effort parse of a V8 style stack into Sentry frames. Frames are ordered
 * oldest first, which is how Sentry expects them. Lines that do not match are
 * skipped so a partial stack still produces useful frames.
 */
function parseStackFrames(stack?: string): SentryStackFrame[] | undefined {
  if (!stack) {
    return undefined;
  }
  const frames: SentryStackFrame[] = [];
  for (const line of stack.split("\n").slice(1)) {
    const match = /at (?:(.+?) )?\(?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
    if (!match) {
      continue;
    }
    frames.push({
      function: match[1],
      filename: match[2],
      lineno: Number(match[3]),
      colno: Number(match[4]),
    });
  }
  return frames.length > 0 ? frames.reverse() : undefined;
}

function randomEventId(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID().replace(/-/g, "");
  }
  let id = "";
  for (let i = 0; i < 32; i += 1) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return id;
}

/** Options for the Sentry reporter. */
export interface SentryReporterOptions {
  dsn: string;
  /** Deployment environment, e.g. "production". */
  environment?: string;
  /** Release identifier, e.g. a version or git sha. */
  release?: string;
  /** Default platform tag. "node" for the Worker, "javascript" for the web. */
  platform?: string;
  /** Component tag applied to every event from this reporter. */
  component?: string;
  /** Injectable fetch, defaults to the global. */
  fetchImpl?: typeof fetch;
}

/**
 * A minimal Sentry client that posts a single event envelope per error. It is
 * intentionally small: no breadcrumbs, sessions, or transports beyond a direct
 * fetch. This is enough to make Worker and web failures observable in Sentry.
 */
export class SentryReporter implements ErrorReporter {
  private readonly parsed: ParsedDsn;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: SentryReporterOptions) {
    const parsed = parseDsn(options.dsn);
    if (!parsed) {
      throw new Error("Invalid Sentry DSN");
    }
    this.parsed = parsed;
    const impl = options.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (!impl) {
      throw new Error("No fetch implementation available for SentryReporter");
    }
    this.fetchImpl = impl;
  }

  captureException(error: unknown, context?: ReportContext): Promise<void> {
    const envelope = this.buildEnvelope(error, context);
    return this.fetchImpl(this.parsed.envelopeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: envelope,
    })
      .then(() => undefined)
      // Reporting must never throw or reject; observability is best effort.
      .catch(() => undefined);
  }

  private buildEnvelope(error: unknown, context?: ReportContext): string {
    const normalized = normalizeError(error);
    const eventId = randomEventId();
    const frames = parseStackFrames(normalized.stack);

    const tags: Record<string, string> = {};
    const component = context?.component ?? this.options.component;
    if (component) {
      tags.component = component;
    }
    if (context?.stage) {
      tags.stage = context.stage;
    }
    Object.assign(tags, context?.tags);

    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: this.options.platform ?? "javascript",
      level: context?.level ?? "error",
      environment: this.options.environment,
      release: this.options.release,
      tags: Object.keys(tags).length > 0 ? tags : undefined,
      extra: context?.extra,
      exception: {
        values: [
          {
            type: normalized.name,
            value: normalized.message,
            stacktrace: frames ? { frames } : undefined,
          },
        ],
      },
      sdk: { name: "meetup-finder.minimal", version: "0.1.0" },
    };

    const header = JSON.stringify({
      event_id: eventId,
      sent_at: new Date().toISOString(),
      dsn: this.options.dsn,
    });
    const itemHeader = JSON.stringify({ type: "event" });
    return `${header}\n${itemHeader}\n${JSON.stringify(event)}`;
  }
}

/** Options for {@link createReporter}. */
export interface CreateReporterOptions extends Omit<SentryReporterOptions, "dsn"> {
  /** Sentry DSN. When missing or invalid, a no op reporter is returned. */
  dsn?: string;
}

/**
 * Build the best reporter available for the given configuration. With a valid
 * DSN this returns a {@link SentryReporter}; otherwise a {@link noopReporter},
 * so calling code never has to branch on whether reporting is configured.
 */
export function createReporter(options: CreateReporterOptions): ErrorReporter {
  if (!options.dsn || !parseDsn(options.dsn)) {
    return noopReporter;
  }
  return new SentryReporter({ ...options, dsn: options.dsn });
}
