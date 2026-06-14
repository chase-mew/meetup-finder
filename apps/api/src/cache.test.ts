import type { SearchRequestBody } from "@meetup/core";
import { describe, expect, it } from "vitest";
import {
  MemoryCache,
  buildAutocompleteCacheKey,
  buildGeocodeCacheKey,
  buildPlaceCacheKey,
  buildReverseGeocodeCacheKey,
  buildSearchCacheKey,
  roundCoord,
} from "./cache";

describe("roundCoord", () => {
  it("rounds to three decimals by default", () => {
    expect(roundCoord(51.530812)).toBe(51.531);
    expect(roundCoord(-0.123881)).toBe(-0.124);
  });
});

describe("buildGeocodeCacheKey", () => {
  it("is case and whitespace insensitive", () => {
    expect(buildGeocodeCacheKey("  Waterloo Station ")).toBe(
      buildGeocodeCacheKey("waterloo station"),
    );
  });
});

describe("buildAutocompleteCacheKey", () => {
  it("normalises case and collapses internal whitespace", () => {
    expect(buildAutocompleteCacheKey("  Kings   Cross ")).toBe(
      buildAutocompleteCacheKey("kings cross"),
    );
  });

  it("differs from the geocode namespace for the same query", () => {
    expect(buildAutocompleteCacheKey("kings cross")).not.toBe(
      buildGeocodeCacheKey("kings cross"),
    );
  });
});

describe("buildReverseGeocodeCacheKey", () => {
  it("rounds coordinates so nearby taps share a key", () => {
    expect(buildReverseGeocodeCacheKey(51.530812, -0.123881)).toBe(
      buildReverseGeocodeCacheKey(51.53072, -0.12391),
    );
  });

  it("differs for distinct coordinates", () => {
    expect(buildReverseGeocodeCacheKey(51.53, -0.12)).not.toBe(
      buildReverseGeocodeCacheKey(51.5, -0.11),
    );
  });
});

describe("buildPlaceCacheKey", () => {
  it("trims the place id", () => {
    expect(buildPlaceCacheKey("  abc ")).toBe(buildPlaceCacheKey("abc"));
  });
});

describe("buildSearchCacheKey", () => {
  const base: SearchRequestBody = {
    origins: [
      { id: "a", location: { lat: 51.5308, lng: -0.1238 } },
      { id: "b", location: { lat: 51.5036, lng: -0.1144 } },
    ],
    category: "cafe",
    mode: "transit",
  };

  it("is independent of origin order", () => {
    const reversed: SearchRequestBody = {
      ...base,
      origins: [base.origins[1]!, base.origins[0]!],
    };
    expect(buildSearchCacheKey(base)).toBe(buildSearchCacheKey(reversed));
  });

  it("treats nearby coordinates as the same key", () => {
    const nudged: SearchRequestBody = {
      ...base,
      origins: [
        { id: "a", location: { lat: 51.53081, lng: -0.12381 } },
        { id: "b", location: { lat: 51.50361, lng: -0.11441 } },
      ],
    };
    expect(buildSearchCacheKey(base)).toBe(buildSearchCacheKey(nudged));
  });

  it("changes when the category or objective changes", () => {
    expect(buildSearchCacheKey(base)).not.toBe(
      buildSearchCacheKey({ ...base, category: "pub" }),
    );
    expect(buildSearchCacheKey(base)).not.toBe(
      buildSearchCacheKey({ ...base, objective: "min_total" }),
    );
  });
});

describe("MemoryCache", () => {
  it("stores and returns values", async () => {
    const cache = new MemoryCache();
    await cache.set("k", { hello: "world" }, 60);
    expect(await cache.get<{ hello: string }>("k")).toEqual({ hello: "world" });
  });

  it("expires entries past their ttl", async () => {
    const cache = new MemoryCache();
    await cache.set("k", 1, 0);
    // ttl 0 means the entry is already expired by the time we read it.
    await new Promise((resolve) => setTimeout(resolve, 2));
    expect(await cache.get("k")).toBeUndefined();
  });

  it("returns undefined for a missing key", async () => {
    const cache = new MemoryCache();
    expect(await cache.get("missing")).toBeUndefined();
  });
});
