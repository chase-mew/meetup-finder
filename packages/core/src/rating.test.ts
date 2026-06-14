import { describe, expect, it } from "vitest";
import { DEFAULT_RATING_PRIOR, bayesianRating, normalizeRating } from "./rating";

describe("bayesianRating", () => {
  it("returns the prior mean with no reviews", () => {
    expect(bayesianRating(5, 0)).toBe(DEFAULT_RATING_PRIOR.mean);
    expect(bayesianRating(undefined, undefined)).toBe(DEFAULT_RATING_PRIOR.mean);
  });

  it("approaches the observed rating as reviews grow", () => {
    const few = bayesianRating(5, 1);
    const many = bayesianRating(5, 5_000);
    expect(many).toBeGreaterThan(few);
    expect(many).toBeGreaterThan(4.9);
  });

  it("ranks a well reviewed good place above a one review perfect place", () => {
    const oneReviewPerfect = bayesianRating(5, 1);
    const wellReviewed = bayesianRating(4.6, 1_000);
    expect(wellReviewed).toBeGreaterThan(oneReviewPerfect);
  });

  it("respects a custom prior", () => {
    const result = bayesianRating(5, 10, { mean: 3, weight: 10 });
    // (10*3 + 10*5) / 20 = 4
    expect(result).toBeCloseTo(4, 9);
  });
});

describe("normalizeRating", () => {
  it("maps the range endpoints to 0 and 1", () => {
    expect(normalizeRating(1)).toBe(0);
    expect(normalizeRating(5)).toBe(1);
    expect(normalizeRating(3)).toBeCloseTo(0.5, 9);
  });

  it("clamps out of range values", () => {
    expect(normalizeRating(-2)).toBe(0);
    expect(normalizeRating(99)).toBe(1);
  });

  it("returns 0 for a degenerate range", () => {
    expect(normalizeRating(3, { min: 4, max: 4 })).toBe(0);
  });
});
