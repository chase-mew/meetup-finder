import { SEARCH_DEFAULTS, type SearchRequestBody } from "@meetup/core";
import { describe, expect, it } from "vitest";
import { buildSearchCacheKey } from "./cache";
import { DEFAULT_SEARCH_CONFIG } from "./search";

const base: SearchRequestBody = {
  origins: [
    { id: "a", location: { lat: 51.5308, lng: -0.1238 } },
    { id: "b", location: { lat: 51.5036, lng: -0.1144 } },
  ],
  category: "cafe",
  mode: "transit",
};

describe("SEARCH_DEFAULTS", () => {
  it("holds the documented canonical values", () => {
    expect(SEARCH_DEFAULTS).toEqual({
      objective: "best",
      travelWeight: 0.7,
      ratingWeight: 0.3,
      limit: 8,
    });
  });
});

describe("default consistency across the pipeline", () => {
  it("uses the shared result limit in the API config", () => {
    expect(DEFAULT_SEARCH_CONFIG.defaultLimit).toBe(SEARCH_DEFAULTS.limit);
  });

  it("falls back to the shared defaults when building a cache key", () => {
    const explicit: SearchRequestBody = {
      ...base,
      objective: SEARCH_DEFAULTS.objective,
      travelWeight: SEARCH_DEFAULTS.travelWeight,
      ratingWeight: SEARCH_DEFAULTS.ratingWeight,
      limit: SEARCH_DEFAULTS.limit,
    };
    expect(buildSearchCacheKey(base)).toBe(buildSearchCacheKey(explicit));
  });
});
