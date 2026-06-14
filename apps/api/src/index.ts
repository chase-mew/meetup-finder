import {
  type ErrorReporter,
  type SearchResponseBody,
  createReporter,
} from "@meetup/core";
import {
  type AutocompletePrediction,
  type GeocodeResult,
  GoogleAutocompleteProvider,
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
  buildAutocompleteCacheKey,
  buildGeocodeCacheKey,
  buildPlaceCacheKey,
  buildReverseGeocodeCacheKey,
  buildSearchCacheKey,
} from "./cache";
import { ConfigError, NotFoundError, ValidationError, toApiError } from "./errors";
import { type LogLevel, type Logger, createLogger } from "./logger";
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
  /** Optional Sentry DSN. When set, errors are reported to Sentry. */
  SENTRY_DSN?: string;
  /** Deployment environment tag for Sentry, e.g. "production". */
  SENTRY_ENVIRONMENT?: string;
  /** Release identifier for Sentry, e.g. a git sha. */
  SENTRY_RELEASE?: string;
  /** Minimum log level: debug | info | warn | error. Defaults to info. */
  LOG_LEVEL?: string;
}

interface Variables {
  logger: Logger;
  reporter: ErrorReporter;
}

const PLACES_PHOTO_BASE = "https://places.googleapis.com/v1";
const GEOCODE_TTL_SECONDS = 24 * 60 * 60;
const SEARCH_TTL_SECONDS = 5 * 60;
const AUTOCOMPLETE_TTL_SECONDS = 60 * 60;
const PLACE_TTL_SECONDS = 24 * 60 * 60;

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

function logLevelFrom(env: Env): LogLevel {
  const level = env.LOG_LEVEL?.toLowerCase();
  return level === "debug" || level === "info" || level === "warn" || level === "error"
    ? level
    : "info";
}

function requireApiKey(env: Env): string {
  if (!env.GOOGLE_MAPS_API_KEY) {
    throw new ConfigError("Server is missing GOOGLE_MAPS_API_KEY");
  }
  return env.GOOGLE_MAPS_API_KEY;
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

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", cors());

// Per request observability: a logger scoped with a request id and route, plus
// an error reporter. Both are stashed on the context for handlers and onError.
app.use("*", async (c, next) => {
  const env = c.env ?? ({} as Env);
  const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
  const logger = createLogger(
    { requestId, method: c.req.method, path: new URL(c.req.url).pathname },
    { minLevel: logLevelFrom(env) },
  );
  const reporter = createReporter({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    release: env.SENTRY_RELEASE,
    component: "api",
    platform: "node",
  });
  c.set("logger", logger);
  c.set("reporter", reporter);

  const start = Date.now();
  await next();
  logger.info("request complete", { status: c.res.status, durationMs: Date.now() - start });
});

// Apply only to the paid endpoints that fan out into Google calls.
app.use("/api/search", rateLimit);
app.use("/api/geocode", rateLimit);
app.use("/api/reverse-geocode", rateLimit);
app.use("/api/place", rateLimit);

// Central error handling: classify the error, log it with context, report it to
// the tracker, then return a structured body the client can branch on.
app.onError(async (err, c) => {
  const apiError = toApiError(err);
  const logger = c.get("logger");
  const detail = { code: apiError.code, status: apiError.status, error: apiError.message };
  // Server faults are errors; client (4xx) problems are expected, so warn.
  if (apiError.status >= 500) {
    logger?.error("request failed", detail);
  } else {
    logger?.warn("request rejected", detail);
  }

  // Only report genuine server side faults to the tracker; client validation
  // errors are expected and would only add noise.
  if (apiError.status >= 500) {
    const reporter = c.get("reporter");
    await reporter?.captureException(apiError, {
      tags: { code: apiError.code },
      extra: { path: new URL(c.req.url).pathname },
      level: "error",
    });
  }

  return c.json(apiError.toBody(), apiError.status as 400 | 404 | 500 | 502);
});

app.get("/api/health", (c) => c.json({ ok: true, service: "meetup-finder-api" }));

app.get("/api/geocode", async (c) => {
  const apiKey = requireApiKey(c.env);
  const query = c.req.query("q")?.trim();
  if (!query) {
    throw new ValidationError("Query parameter q is required");
  }

  const cache = cacheFor(c.env);
  const cacheKey = buildGeocodeCacheKey(query);
  const cached = await cache.get<GeocodeResult | null>(cacheKey);
  if (cached !== undefined) {
    if (!cached) {
      throw new NotFoundError("No match found");
    }
    return c.json(cached);
  }

  const provider = new GoogleGeocodingProvider({ apiKey });
  const result = await provider.geocode(query);
  await cache.set(cacheKey, result, GEOCODE_TTL_SECONDS);
  if (!result) {
    throw new NotFoundError("No match found");
  }
  return c.json(result);
});

app.get("/api/autocomplete", async (c) => {
  const apiKey = requireApiKey(c.env);
  const query = c.req.query("q")?.trim();
  if (!query) {
    return c.json({ predictions: [] });
  }

  const cache = cacheFor(c.env);
  const cacheKey = buildAutocompleteCacheKey(query);
  const cached = await cache.get<AutocompletePrediction[]>(cacheKey);
  if (cached !== undefined) {
    return c.json({ predictions: cached });
  }

  const provider = new GoogleAutocompleteProvider({ apiKey });
  const predictions = await provider.autocomplete(query);
  await cache.set(cacheKey, predictions, AUTOCOMPLETE_TTL_SECONDS);
  return c.json({ predictions });
});

app.get("/api/place", async (c) => {
  const apiKey = requireApiKey(c.env);
  const placeId = c.req.query("placeId")?.trim();
  if (!placeId) {
    throw new ValidationError("Query parameter placeId is required");
  }

  const cache = cacheFor(c.env);
  const cacheKey = buildPlaceCacheKey(placeId);
  const cached = await cache.get<GeocodeResult | null>(cacheKey);
  if (cached !== undefined) {
    if (!cached) {
      throw new NotFoundError("No match found");
    }
    return c.json(cached);
  }

  const provider = new GoogleAutocompleteProvider({ apiKey });
  const result = await provider.resolve(placeId);
  await cache.set(cacheKey, result, PLACE_TTL_SECONDS);
  if (!result) {
    throw new NotFoundError("No match found");
  }
  return c.json(result);
});

app.get("/api/reverse-geocode", async (c) => {
  const apiKey = requireApiKey(c.env);
  const lat = parseCoord(c.req.query("lat"), 90);
  const lng = parseCoord(c.req.query("lng"), 180);
  if (lat === null || lng === null) {
    throw new ValidationError("Valid lat and lng query parameters are required");
  }

  const cache = cacheFor(c.env);
  const cacheKey = buildReverseGeocodeCacheKey(lat, lng);
  const cached = await cache.get<GeocodeResult | null>(cacheKey);
  if (cached !== undefined) {
    if (!cached) {
      throw new NotFoundError("No match found");
    }
    return c.json(cached);
  }

  const provider = new GoogleGeocodingProvider({ apiKey });
  const result = await provider.reverseGeocode({ lat, lng });
  await cache.set(cacheKey, result, GEOCODE_TTL_SECONDS);
  if (!result) {
    throw new NotFoundError("No match found");
  }
  return c.json(result);
});

app.post("/api/search", async (c) => {
  const apiKey = requireApiKey(c.env);
  const logger = c.get("logger").child({ route: "/api/search" });

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }

  const validated = validateSearchRequest(raw);
  if (!validated.ok) {
    throw new ValidationError(validated.error);
  }

  const cache = cacheFor(c.env);
  const cacheKey = buildSearchCacheKey(validated.value);
  const cached = await cache.get<SearchResponseBody>(cacheKey);
  if (cached) {
    logger.info("search cache hit");
    return c.json(cached);
  }

  const deps = {
    places: new GooglePlacesProvider({ apiKey }),
    travel: new GoogleTravelProvider({ apiKey }),
    logger,
  };
  const result = await runSearch(deps, validated.value);
  await cache.set(cacheKey, result, SEARCH_TTL_SECONDS);
  return c.json(result);
});

app.get("/api/photo", async (c) => {
  const apiKey = requireApiKey(c.env);
  const ref = c.req.query("ref");
  if (!ref || !ref.startsWith("places/")) {
    throw new ValidationError("A valid photo ref is required");
  }
  const maxWidth = clampInt(c.req.query("maxWidth"), 400, 100, 1600);

  const url = `${PLACES_PHOTO_BASE}/${ref}/media?maxWidthPx=${maxWidth}&key=${apiKey}`;
  const upstream = await fetch(url);
  if (!upstream.ok) {
    c.get("logger").warn("photo upstream failed", { status: upstream.status });
    return c.json({ error: "Failed to load photo", code: "provider_error" }, 502);
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

export default app;
