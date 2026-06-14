import type { Objective } from "./types";

/**
 * Canonical default values for a search request.
 *
 * These are the single source of truth shared by the web app, the API config,
 * and the cache key fallbacks. Keep doc comments on `SearchRequestBody` in sync
 * with these values.
 */
export const SEARCH_DEFAULTS = {
  /** Balance all objectives by averaging their normalised costs. */
  objective: "best",
  /** How much travel matters, 0..1. */
  travelWeight: 0.7,
  /** How much rating matters, 0..1. */
  ratingWeight: 0.3,
  /** Number of results to return. */
  limit: 8,
} as const satisfies {
  objective: Objective;
  travelWeight: number;
  ratingWeight: number;
  limit: number;
};
