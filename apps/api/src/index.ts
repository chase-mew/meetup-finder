import type { SearchResponseBody } from "@meetup/core";
import {
  type GeocodeResult,
  GoogleGeocodingProvider,
  GooglePlacesProvider,
  GoogleTravelProvider,
} from "@meetup/providers";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import {
  type AsyncCache,
  KvCache,
  MemoryCache,
  buildGeocodeCacheKey,
  buildReverseGeocodeCacheKey,
  buildSearchCacheKey,
} from "./cache";
import {
  KvRateLimitStore,
  MemoryRateLimitStore,
  RateLimiter,
  type RateLimitEnv,
  type RateLimitStore,
  rateLimitConfigFromEnv,
  rateLimitMessage,
} from "./rateLimit";
import { runSearch } from "./search";
import { validateSearchRequest } from "./validation";

interface Env extends RateLimitEnv {
  GOOGLE_MAPS_API_KEY: string;
  /** Optional KV namespace for durable caching across isolates. */
  CACHE?: KVNamespace;
}

const PLACES_PHOTO_BASE = "https://places.googleapis.com/v1";
const GEOCODE_TTL_SECONDS = 24 * 60 * 60;
const SEARCH_TTL_SECONDS = 5 * 60;

// Fallback for local dev or when no KV namespace is bound.
const memoryCache = new MemoryCache(700);

function cacheFor(env: Env): AsyncCache {
  return env.CACHE ? new KvCache(env.CACHE) : memoryCache;
}

// Per isolate fallback store for rate limit state when no KV is bound.
const memoryRateLimitStore = new MemoryRateLimitStore();

function rateLimitStoreFor(env: Env): RateLimitStore {
  return env.CACHE ? new KvRateLimitStore(env.CACHE) : memoryRateLimitStore;
}

function clientIdOf(c: { req: { header: (name: string) => string | undefined } }): string {
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) {
    return cfIp;
  }
  const forwarded = c.req.header("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || "unknown";
}

// Throttles paid endpoints per client, keyed by cf-connecting-ip, with an
// optional global daily ceiling. Configured via RATE_LIMIT_* env vars.
const rateLimit = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const config = rateLimitConfigFromEnv(c.env);
  if (!config) {
    return next();
  }
  const limiter = new RateLimiter(rateLimitStoreFor(c.env), config);
  let result: Awaited<ReturnType<RateLimiter["check"]>>;
  try {
    result = await limiter.check(clientIdOf(c));
  } catch (error) {
    // Fail open: a transient store outage must not take the endpoint down.
    console.error("Rate limiter check failed, allowing request:", error);
    return next();
  }
  if (!result.allowed) {
    c.header("Retry-After", String(result.retryAfterSeconds));
    return c.json({ error: rateLimitMessage(result) }, 429);
  }
  return next();
});

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

// Apply only to the paid endpoints that fan out into Google calls.
app.use("/api/search", rateLimit);
app.use("/api/geocode", rateLimit);

app.get("/api/health", (c) => c.json({ ok: true, service: "meetup-finder-api" }));

app.get("/api/geocode", async (c) => {
  const apiKey = c.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return c.json({ error: "Server is missing GOOGLE_MAPS_API_KEY" }, 500);
  }
  const query = c.req.query("q")?.trim();
  if (!query) {
    return c.json({ error: "Query parameter q is required" }, 400);
  }

  const cache = cacheFor(c.env);
  const cacheKey = buildGeocodeCacheKey(query);
  const cached = await cache.get<GeocodeResult | null>(cacheKey);
  if (cached !== undefined) {
    return cached ? c.json(cached) : c.json({ error: "No match found" }, 404);
  }

  try {
    const provider = new GoogleGeocodingProvider({ apiKey });
    const result = await provider.geocode(query);
    await cache.set(cacheKey, result, GEOCODE_TTL_SECONDS);
    return result ? c.json(result) : c.json({ error: "No match found" }, 404);
  } catch (error) {
    return c.json({ error: messageOf(error) }, 502);
  }
});

app.get("/api/reverse-geocode", async (c) => {
  const apiKey = c.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return c.json({ error: "Server is missing GOOGLE_MAPS_API_KEY" }, 500);
  }
  const lat = parseCoord(c.req.query("lat"), 90);
  const lng = parseCoord(c.req.query("lng"), 180);
  if (lat === null || lng === null) {
    return c.json({ error: "Valid lat and lng query parameters are required" }, 400);
  }

  const cache = cacheFor(c.env);
  const cacheKey = buildReverseGeocodeCacheKey(lat, lng);
  const cached = await cache.get<GeocodeResult | null>(cacheKey);
  if (cached !== undefined) {
    return cached ? c.json(cached) : c.json({ error: "No match found" }, 404);
  }

  try {
    const provider = new GoogleGeocodingProvider({ apiKey });
    const result = await provider.reverseGeocode({ lat, lng });
    await cache.set(cacheKey, result, GEOCODE_TTL_SECONDS);
    return result ? c.json(result) : c.json({ error: "No match found" }, 404);
  } catch (error) {
    return c.json({ error: messageOf(error) }, 502);
  }
});

app.post("/api/search", async (c) => {
  const apiKey = c.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return c.json({ error: "Server is missing GOOGLE_MAPS_API_KEY" }, 500);
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const validated = validateSearchRequest(raw);
  if (!validated.ok) {
    return c.json({ error: validated.error }, 400);
  }

  const cache = cacheFor(c.env);
  const cacheKey = buildSearchCacheKey(validated.value);
  const cached = await cache.get<SearchResponseBody>(cacheKey);
  if (cached) {
    return c.json(cached);
  }

  try {
    const deps = {
      places: new GooglePlacesProvider({ apiKey }),
      travel: new GoogleTravelProvider({ apiKey }),
    };
    const result = await runSearch(deps, validated.value);
    await cache.set(cacheKey, result, SEARCH_TTL_SECONDS);
    return c.json(result);
  } catch (error) {
    return c.json({ error: messageOf(error) }, 502);
  }
});

app.get("/api/photo", async (c) => {
  const apiKey = c.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return c.json({ error: "Server is missing GOOGLE_MAPS_API_KEY" }, 500);
  }
  const ref = c.req.query("ref");
  if (!ref || !ref.startsWith("places/")) {
    return c.json({ error: "A valid photo ref is required" }, 400);
  }
  const maxWidth = clampInt(c.req.query("maxWidth"), 400, 100, 1600);

  const url = `${PLACES_PHOTO_BASE}/${ref}/media?maxWidthPx=${maxWidth}&key=${apiKey}`;
  const upstream = await fetch(url);
  if (!upstream.ok) {
    return c.json({ error: "Failed to load photo" }, 502);
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
});

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

export function parseCoord(value: string | undefined, max: number): number | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > max) {
    return null;
  }
  return parsed;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

export default app;
