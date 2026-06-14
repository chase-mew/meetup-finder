import { SEARCH_DEFAULTS, type SearchRequestBody } from "@meetup/core";

/** A small async cache abstraction so memory and KV are interchangeable. */
export interface AsyncCache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

interface Entry {
  value: unknown;
  expires: number;
}

/**
 * In memory cache, scoped to a single Worker isolate. Best effort and
 * ephemeral. Used as a fallback when no KV namespace is bound.
 */
export class MemoryCache implements AsyncCache {
  private readonly store = new Map<string, Entry>();

  constructor(private readonly maxEntries = 500) {}

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) {
        this.store.delete(oldest);
      }
    }
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }
}

/** Durable cache backed by a Cloudflare KV namespace, shared across isolates. */
export class KvCache implements AsyncCache {
  constructor(private readonly kv: KVNamespace) {}

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.kv.get(key);
    if (raw === null) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    // KV enforces a minimum expiration of 60 seconds.
    await this.kv.put(key, JSON.stringify(value), {
      expirationTtl: Math.max(60, Math.round(ttlSeconds)),
    });
  }
}

/** Round a coordinate so nearby points share a cache entry (3 dp is about 110 m). */
export function roundCoord(value: number, decimals = 3): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Build a stable, order independent cache key for a search request.
 * Origins are rounded and sorted so that small address differences and a
 * different input order still hit the same cached result.
 */
export function buildSearchCacheKey(body: SearchRequestBody): string {
  const origins = body.origins
    .map((origin) => [
      roundCoord(origin.location.lat),
      roundCoord(origin.location.lng),
      origin.weight ?? 1,
    ])
    .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!);

  const shape = {
    o: origins,
    c: body.category,
    m: body.mode,
    obj: body.objective ?? SEARCH_DEFAULTS.objective,
    tw: body.travelWeight ?? SEARCH_DEFAULTS.travelWeight,
    rw: body.ratingWeight ?? SEARCH_DEFAULTS.ratingWeight,
    l: body.limit ?? SEARCH_DEFAULTS.limit,
    on: body.openNow ?? false,
    r: body.searchRadiusMeters ?? null,
  };
  return `search:v1:${JSON.stringify(shape)}`;
}

export function buildGeocodeCacheKey(query: string): string {
  return `geo:v1:${query.trim().toLowerCase()}`;
}
