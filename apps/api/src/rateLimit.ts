/**
 * Lightweight abuse protection for the public Worker.
 *
 * Each search fans out into several paid Google calls, so an unthrottled
 * public endpoint could run up a large bill. This module implements a per
 * client token bucket plus an optional global daily ceiling, backed by a
 * pluggable store so it works on Workers KV in production and in memory for
 * local dev and tests.
 */

/** Minimal key value store the limiter needs. Workers KV satisfies this. */
export interface RateLimitStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface RateLimitConfig {
  /** Sustained per client request rate, expressed as tokens added per second. */
  refillPerSecond: number;
  /** Per client bucket capacity, i.e. the largest burst allowed. */
  burst: number;
  /** Optional ceiling on total allowed requests per UTC day across all clients. */
  dailyMax?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the client should wait before retrying, when blocked. */
  retryAfterSeconds: number;
  /** Which limit triggered the block, useful for logging and messaging. */
  scope?: "ip" | "global";
}

interface BucketState {
  /** Tokens remaining, can be fractional while refilling. */
  tokens: number;
  /** Last update time in milliseconds since the epoch. */
  updatedAt: number;
}

const SECONDS_PER_DAY = 24 * 60 * 60;

/** KV adapter. KV enforces a 60 second minimum expiration, so we clamp ttl. */
export class KvRateLimitStore implements RateLimitStore {
  constructor(private readonly kv: KVNamespace) {}

  get(key: string): Promise<string | null> {
    return this.kv.get(key);
  }

  put(key: string, value: string, ttlSeconds: number): Promise<void> {
    return this.kv.put(key, value, {
      expirationTtl: Math.max(60, Math.ceil(ttlSeconds)),
    });
  }
}

/**
 * In memory store, scoped to a single isolate. Fallback for local dev.
 *
 * Expired entries are dropped on read, and writes are capped at maxEntries to
 * stop a flood of one off client ids from growing the map without bound: once
 * full, expired keys are swept first, then the oldest entries are evicted.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly store = new Map<string, { value: string; expires: number }>();

  constructor(private readonly maxEntries = 10_000) {}

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expires <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, ttlSeconds: number): Promise<void> {
    const now = Date.now();
    this.store.set(key, { value, expires: now + ttlSeconds * 1000 });
    if (this.store.size > this.maxEntries) {
      this.evict(now);
    }
  }

  private evict(now: number): void {
    for (const [key, entry] of this.store) {
      if (entry.expires <= now) {
        this.store.delete(key);
      }
    }
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.store.delete(oldest);
    }
  }
}

/**
 * Token bucket rate limiter with an optional global daily ceiling.
 *
 * The bucket is a best effort guardrail: KV is eventually consistent across
 * edge locations, so a determined client spread across regions might exceed
 * the nominal rate slightly. That is acceptable here because the goal is to
 * bound cost, not to enforce an exact quota.
 */
export class RateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly config: RateLimitConfig,
  ) {}

  async check(clientId: string, now: number = Date.now()): Promise<RateLimitResult> {
    const globalBlock = await this.checkGlobalCeiling(now);
    if (globalBlock) {
      return globalBlock;
    }

    const ipResult = await this.consumeToken(clientId, now);
    if (!ipResult.allowed) {
      return ipResult;
    }

    await this.incrementGlobalCount(now);
    return ipResult;
  }

  private async checkGlobalCeiling(now: number): Promise<RateLimitResult | null> {
    const { dailyMax } = this.config;
    if (!dailyMax || dailyMax <= 0) {
      return null;
    }
    const count = await this.readGlobalCount(now);
    if (count >= dailyMax) {
      return {
        allowed: false,
        retryAfterSeconds: secondsUntilNextUtcDay(now),
        scope: "global",
      };
    }
    return null;
  }

  private async consumeToken(clientId: string, now: number): Promise<RateLimitResult> {
    const { burst, refillPerSecond } = this.config;
    const key = `rl:ip:${clientId}`;
    const state = parseBucket(await this.store.get(key), burst, now);

    const elapsedSeconds = Math.max(0, (now - state.updatedAt) / 1000);
    const tokens = Math.min(burst, state.tokens + elapsedSeconds * refillPerSecond);

    if (tokens < 1) {
      const deficit = 1 - tokens;
      const retryAfterSeconds = refillPerSecond > 0 ? Math.ceil(deficit / refillPerSecond) : 1;
      return { allowed: false, retryAfterSeconds, scope: "ip" };
    }

    const next: BucketState = { tokens: tokens - 1, updatedAt: now };
    // Keep the entry around long enough for a fully drained bucket to refill.
    const ttlSeconds = refillPerSecond > 0 ? burst / refillPerSecond : SECONDS_PER_DAY;
    await this.store.put(key, JSON.stringify(next), ttlSeconds);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private async readGlobalCount(now: number): Promise<number> {
    const raw = await this.store.get(globalKey(now));
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private async incrementGlobalCount(now: number): Promise<void> {
    if (!this.config.dailyMax || this.config.dailyMax <= 0) {
      return;
    }
    const count = await this.readGlobalCount(now);
    await this.store.put(globalKey(now), String(count + 1), secondsUntilNextUtcDay(now));
  }
}

function parseBucket(raw: string | null, burst: number, now: number): BucketState {
  if (!raw) {
    return { tokens: burst, updatedAt: now };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<BucketState>;
    const tokens =
      typeof parsed.tokens === "number" && Number.isFinite(parsed.tokens) ? parsed.tokens : burst;
    const updatedAt =
      typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
        ? parsed.updatedAt
        : now;
    return { tokens: Math.min(burst, tokens), updatedAt };
  } catch {
    return { tokens: burst, updatedAt: now };
  }
}

function globalKey(now: number): string {
  return `rl:global:${utcDay(now)}`;
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function secondsUntilNextUtcDay(now: number): number {
  const date = new Date(now);
  const nextMidnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((nextMidnight - now) / 1000));
}

/** Read and validate limiter config from string valued environment variables. */
export interface RateLimitEnv {
  RATE_LIMIT_ENABLED?: string;
  RATE_LIMIT_RPM?: string;
  RATE_LIMIT_BURST?: string;
  RATE_LIMIT_DAILY_MAX?: string;
}

const DEFAULT_RPM = 30;
const DEFAULT_BURST = 15;

/**
 * Build a config from env, or return null when rate limiting is disabled.
 * Set RATE_LIMIT_ENABLED to "false" to turn it off entirely.
 */
export function rateLimitConfigFromEnv(env: RateLimitEnv): RateLimitConfig | null {
  if (env.RATE_LIMIT_ENABLED?.toLowerCase() === "false") {
    return null;
  }

  const rpm = positiveIntOr(env.RATE_LIMIT_RPM, DEFAULT_RPM);
  const burst = positiveIntOr(env.RATE_LIMIT_BURST, DEFAULT_BURST);
  const dailyMax = positiveIntOr(env.RATE_LIMIT_DAILY_MAX, 0);

  return {
    refillPerSecond: rpm / 60,
    burst,
    dailyMax: dailyMax > 0 ? dailyMax : undefined,
  };
}

function positiveIntOr(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** A short, user friendly message for a blocked request. */
export function rateLimitMessage(result: RateLimitResult): string {
  if (result.scope === "global") {
    return "The service is busy right now. Please try again later.";
  }
  return `Too many requests. Please slow down and try again in ${result.retryAfterSeconds}s.`;
}
