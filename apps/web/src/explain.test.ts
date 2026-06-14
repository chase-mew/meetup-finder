import type { ResultVenue, ScoreWeights, SearchResponseBody } from "@meetup/core";
import { describe, expect, it } from "vitest";
import { explainResultsGeography, explainVenue } from "./explain";

const WEIGHTS: ScoreWeights = { travel: 0.7, rating: 0.3 };

function makeVenue(overrides: Partial<ResultVenue> = {}): ResultVenue {
  return {
    id: "v1",
    name: "Test Venue",
    location: { lat: 0, lng: 0 },
    reachable: true,
    finalScore: 0.2,
    bayesianRating: 4.4,
    objectiveCostSeconds: 600,
    totalSeconds: 1200,
    maxSeconds: 900,
    normalizedTravel: 0.1,
    normalizedRating: 0.7,
    legs: [],
    ...overrides,
  };
}

describe("explainVenue", () => {
  it("leads with the objective when the venue wins on travel", () => {
    const venue = makeVenue({ normalizedTravel: 0.05, normalizedRating: 0.6 });
    expect(explainVenue(venue, "min_max", WEIGHTS).headline).toBe(
      "Fairest worst trip among the options",
    );
    expect(explainVenue(venue, "min_total", WEIGHTS).headline).toBe(
      "Lowest combined travel for the group",
    );
  });

  it("explains a rating led pick when travel is worse but rating carries it", () => {
    const venue = makeVenue({ normalizedTravel: 0.9, normalizedRating: 0.95 });
    const explanation = explainVenue(venue, "best", { travel: 0.3, rating: 0.7 });
    expect(explanation.headline).toBe("Higher rated, slightly longer for most");
    expect(explanation.ratingShare).toBeGreaterThan(explanation.travelShare);
  });

  it("describes a travel led pick when travel drives the ranking", () => {
    const venue = makeVenue({ normalizedTravel: 0.4, normalizedRating: 0.45 });
    const explanation = explainVenue(venue, "best", WEIGHTS);
    expect(explanation.headline).toBe("Quick for the group, and fairly rated");
    expect(explanation.travelShare).toBeGreaterThan(explanation.ratingShare);
  });

  it("flags venues that cannot be reached by everyone", () => {
    const venue = makeVenue({ reachable: false, maxSeconds: 3600 });
    const explanation = explainVenue(venue, "min_max", WEIGHTS);
    expect(explanation.headline).toBe("Not everyone can reach this one");
    expect(explanation.detail).toContain("1 h");
  });

  it("returns shares that sum to one", () => {
    const explanation = explainVenue(makeVenue(), "best", WEIGHTS);
    expect(explanation.travelShare + explanation.ratingShare).toBeCloseTo(1, 5);
  });

  it("falls back to the weights when a venue has no measurable strength", () => {
    const venue = makeVenue({ normalizedTravel: 1, normalizedRating: 0 });
    const explanation = explainVenue(venue, "best", { travel: 0.6, rating: 0.4 });
    expect(explanation.travelShare).toBeCloseTo(0.6, 5);
    expect(explanation.ratingShare).toBeCloseTo(0.4, 5);
  });

  it("normalizes the fallback so shares sum to one even with raw weights", () => {
    const venue = makeVenue({ normalizedTravel: 1, normalizedRating: 0 });
    const explanation = explainVenue(venue, "best", { travel: 7, rating: 3 });
    expect(explanation.travelShare).toBeCloseTo(0.7, 5);
    expect(explanation.travelShare + explanation.ratingShare).toBeCloseTo(1, 5);
  });
});

describe("explainResultsGeography", () => {
  const baseResult: Pick<SearchResponseBody, "objective" | "mode" | "origins" | "venues"> = {
    objective: "best",
    mode: "transit",
    origins: [
      { id: "a", label: "Alice", location: { lat: 51.5, lng: -0.1 } },
      { id: "b", label: "Bob", location: { lat: 51.51, lng: -0.12 } },
    ],
    venues: [makeVenue()],
  };

  it("returns null when there are no venues", () => {
    expect(explainResultsGeography({ ...baseResult, venues: [] })).toBeNull();
  });

  it("explains the fair-travel choice and why central was skipped", () => {
    const summary = explainResultsGeography(baseResult);
    expect(summary).not.toBeNull();
    expect(summary!.detail).toContain("public transport");
    expect(summary!.detail).toContain("all 2 of you");
    expect(summary!.detail.toLowerCase()).toContain("central");
    expect(summary!.detail.toLowerCase()).toContain("longer trip");
  });

  it("names the chosen travel mode", () => {
    const summary = explainResultsGeography({ ...baseResult, mode: "walking" });
    expect(summary!.detail).toContain("walking");
  });

  it("reads naturally for a single origin", () => {
    const summary = explainResultsGeography({
      ...baseResult,
      origins: [{ id: "a", label: "Alice", location: { lat: 51.5, lng: -0.1 } }],
    });
    expect(summary!.detail).toContain("for you");
    expect(summary!.detail).not.toContain("all 1 of you");
  });
});
