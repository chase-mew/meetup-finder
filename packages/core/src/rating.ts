import type { RatingPrior } from "./types";

/** Sensible default prior: damp toward 3.8 with the strength of 20 reviews. */
export const DEFAULT_RATING_PRIOR: RatingPrior = { mean: 3.8, weight: 20 };

/**
 * Bayesian average rating.
 *
 * A place with a single five star review should not beat a place with a
 * thousand reviews at 4.6. Blending the observed rating toward a prior mean,
 * weighted by review count, fixes that.
 */
export function bayesianRating(
  rating: number | undefined,
  ratingCount: number | undefined,
  prior: RatingPrior = DEFAULT_RATING_PRIOR,
): number {
  const count = ratingCount ?? 0;
  if (rating === undefined || count <= 0) {
    return prior.mean;
  }
  return (prior.weight * prior.mean + count * rating) / (prior.weight + count);
}

/** Map a rating onto 0..1 where 1 is best, clamped to the range. */
export function normalizeRating(
  value: number,
  range: { min: number; max: number } = { min: 1, max: 5 },
): number {
  const span = range.max - range.min;
  if (span <= 0) {
    return 0;
  }
  const normalized = (value - range.min) / span;
  return Math.min(1, Math.max(0, normalized));
}
