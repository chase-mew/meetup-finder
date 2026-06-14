import { describe, expect, it } from "vitest";
import {
  MemoryRateLimitStore,
  RateLimiter,
  rateLimitConfigFromEnv,
  rateLimitMessage,
} from "./rateLimit";

describe("RateLimiter token bucket", () => {
  it("allows requests up to the burst capacity then blocks", async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore(), {
      refillPerSecond: 0,
      burst: 3,
    });
    const now = 1_000_000;

    for (let i = 0; i < 3; i++) {
      const result = await limiter.check("1.2.3.4", now);
      expect(result.allowed).toBe(true);
    }

    const blocked = await limiter.check("1.2.3.4", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe("ip");
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps separate buckets per client", async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore(), {
      refillPerSecond: 0,
      burst: 1,
    });
    const now = 1_000_000;

    expect((await limiter.check("a", now)).allowed).toBe(true);
    expect((await limiter.check("a", now)).allowed).toBe(false);
    // A different client still has a full bucket.
    expect((await limiter.check("b", now)).allowed).toBe(true);
  });

  it("refills tokens as time passes", async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore(), {
      refillPerSecond: 1,
      burst: 1,
    });
    const start = 1_000_000;

    expect((await limiter.check("ip", start)).allowed).toBe(true);
    expect((await limiter.check("ip", start)).allowed).toBe(false);
    // One second later a token has been refilled.
    expect((await limiter.check("ip", start + 1000)).allowed).toBe(true);
  });

  it("reports a sensible retry-after based on the refill rate", async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore(), {
      refillPerSecond: 0.5,
      burst: 1,
    });
    const now = 1_000_000;

    await limiter.check("ip", now);
    const blocked = await limiter.check("ip", now);
    expect(blocked.allowed).toBe(false);
    // 0.5 tokens/sec means a full token takes 2 seconds to refill.
    expect(blocked.retryAfterSeconds).toBe(2);
  });
});

describe("RateLimiter global daily ceiling", () => {
  it("blocks all clients once the daily ceiling is reached", async () => {
    const limiter = new RateLimiter(new MemoryRateLimitStore(), {
      refillPerSecond: 0,
      burst: 100,
      dailyMax: 2,
    });
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);

    expect((await limiter.check("a", now)).allowed).toBe(true);
    expect((await limiter.check("b", now)).allowed).toBe(true);

    const blocked = await limiter.check("c", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe("global");
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("does not consume the global count when the per client limit blocks first", async () => {
    const store = new MemoryRateLimitStore();
    const limiter = new RateLimiter(store, {
      refillPerSecond: 0,
      burst: 1,
      dailyMax: 5,
    });
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);

    expect((await limiter.check("a", now)).allowed).toBe(true);
    // Second request from the same client is blocked by the bucket, not global.
    const blocked = await limiter.check("a", now);
    expect(blocked.scope).toBe("ip");

    const day = new Date(now).toISOString().slice(0, 10);
    expect(await store.get(`rl:global:${day}`)).toBe("1");
  });
});

describe("MemoryRateLimitStore", () => {
  it("expires entries past their ttl", async () => {
    const store = new MemoryRateLimitStore();
    await store.put("k", "v", 0);
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(await store.get("k")).toBeNull();
  });
});

describe("rateLimitConfigFromEnv", () => {
  it("returns sensible defaults with no env set", () => {
    const config = rateLimitConfigFromEnv({});
    expect(config).not.toBeNull();
    expect(config!.refillPerSecond).toBeCloseTo(0.5);
    expect(config!.burst).toBe(15);
    expect(config!.dailyMax).toBeUndefined();
  });

  it("returns null when disabled", () => {
    expect(rateLimitConfigFromEnv({ RATE_LIMIT_ENABLED: "false" })).toBeNull();
    expect(rateLimitConfigFromEnv({ RATE_LIMIT_ENABLED: "FALSE" })).toBeNull();
  });

  it("parses custom values", () => {
    const config = rateLimitConfigFromEnv({
      RATE_LIMIT_RPM: "120",
      RATE_LIMIT_BURST: "40",
      RATE_LIMIT_DAILY_MAX: "1000",
    });
    expect(config!.refillPerSecond).toBeCloseTo(2);
    expect(config!.burst).toBe(40);
    expect(config!.dailyMax).toBe(1000);
  });

  it("falls back to defaults for invalid values", () => {
    const config = rateLimitConfigFromEnv({
      RATE_LIMIT_RPM: "0",
      RATE_LIMIT_BURST: "-5",
      RATE_LIMIT_DAILY_MAX: "abc",
    });
    expect(config!.refillPerSecond).toBeCloseTo(0.5);
    expect(config!.burst).toBe(15);
    expect(config!.dailyMax).toBeUndefined();
  });
});

describe("rateLimitMessage", () => {
  it("differs for ip and global scopes", () => {
    expect(rateLimitMessage({ allowed: false, retryAfterSeconds: 5, scope: "ip" })).toContain("5s");
    expect(
      rateLimitMessage({ allowed: false, retryAfterSeconds: 5, scope: "global" }),
    ).toContain("busy");
  });
});
