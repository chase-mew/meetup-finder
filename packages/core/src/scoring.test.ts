import { describe, expect, it } from "vitest";
import { scoreVenues } from "./scoring";
import type { ScoringCandidate } from "./types";

describe("scoreVenues", () => {
  it("ranks the lower travel venue first when rating is equal", () => {
    const candidates: ScoringCandidate[] = [
      { id: "close", rating: 4.5, ratingCount: 500, durationsSeconds: [600, 600] },
      { id: "far", rating: 4.5, ratingCount: 500, durationsSeconds: [1800, 1800] },
    ];
    const ranked = scoreVenues(candidates, { objective: "min_max" });
    expect(ranked[0]!.id).toBe("close");
    expect(ranked[0]!.finalScore).toBeLessThan(ranked[1]!.finalScore);
  });

  it("uses min_max to prefer the fairer venue", () => {
    const candidates: ScoringCandidate[] = [
      // Same total (3600) but very different worst cases.
      { id: "fair", rating: 4, ratingCount: 200, durationsSeconds: [1700, 1900] },
      { id: "lopsided", rating: 4, ratingCount: 200, durationsSeconds: [200, 3400] },
    ];
    const ranked = scoreVenues(candidates, { objective: "min_max" });
    expect(ranked[0]!.id).toBe("fair");
  });

  it("uses min_total to prefer the most efficient venue", () => {
    const candidates: ScoringCandidate[] = [
      { id: "efficient", rating: 4, ratingCount: 200, durationsSeconds: [500, 700] },
      { id: "even", rating: 4, ratingCount: 200, durationsSeconds: [900, 900] },
    ];
    const ranked = scoreVenues(candidates, { objective: "min_total" });
    expect(ranked[0]!.id).toBe("efficient");
  });

  it("lets a strong rating outweigh slightly worse travel when weighted heavily", () => {
    const candidates: ScoringCandidate[] = [
      { id: "meh-close", rating: 3.0, ratingCount: 1_000, durationsSeconds: [600, 600] },
      { id: "great-far", rating: 4.9, ratingCount: 1_000, durationsSeconds: [900, 900] },
    ];
    const ranked = scoreVenues(candidates, {
      objective: "min_max",
      weights: { travel: 0.2, rating: 0.8 },
    });
    expect(ranked[0]!.id).toBe("great-far");
  });

  it("ranks unreachable venues below reachable ones", () => {
    const candidates: ScoringCandidate[] = [
      { id: "reachable", rating: 3.5, ratingCount: 50, durationsSeconds: [2400, 2400] },
      { id: "unreachable", rating: 5, ratingCount: 5_000, durationsSeconds: [600, null] },
    ];
    const ranked = scoreVenues(candidates, { objective: "min_max" });
    expect(ranked[0]!.id).toBe("reachable");
    const unreachable = ranked.find((r) => r.id === "unreachable");
    expect(unreachable?.reachable).toBe(false);
    expect(unreachable?.finalScore).toBeGreaterThan(1);
  });

  it("exposes the per venue travel statistics", () => {
    const candidates: ScoringCandidate[] = [
      { id: "a", rating: 4.2, ratingCount: 100, durationsSeconds: [600, 1200] },
    ];
    const [scored] = scoreVenues(candidates, { objective: "min_max" });
    expect(scored!.totalSeconds).toBe(1800);
    expect(scored!.maxSeconds).toBe(1200);
    expect(scored!.reachable).toBe(true);
    expect(scored!.finalScore).toBeGreaterThanOrEqual(0);
  });

  it("best objective prefers a venue strong on all three measures", () => {
    const candidates: ScoringCandidate[] = [
      { id: "allround", rating: 4.5, ratingCount: 500, durationsSeconds: [600, 600] },
      { id: "unfair", rating: 4.5, ratingCount: 500, durationsSeconds: [200, 3000] },
      { id: "slow", rating: 4.5, ratingCount: 500, durationsSeconds: [1500, 1500] },
    ];
    const ranked = scoreVenues(candidates, { objective: "best" });
    expect(ranked[0]!.id).toBe("allround");
  });

  it("best objective reports the worst trip as the headline cost", () => {
    const candidates: ScoringCandidate[] = [
      { id: "a", rating: 4, ratingCount: 100, durationsSeconds: [600, 1200] },
    ];
    const [scored] = scoreVenues(candidates, { objective: "best" });
    expect(scored!.objectiveCostSeconds).toBe(scored!.maxSeconds);
  });

  it("best objective falls back to rating when travel is identical", () => {
    const candidates: ScoringCandidate[] = [
      { id: "low", rating: 3.2, ratingCount: 800, durationsSeconds: [600, 600] },
      { id: "high", rating: 4.8, ratingCount: 800, durationsSeconds: [600, 600] },
    ];
    const ranked = scoreVenues(candidates, { objective: "best" });
    expect(ranked[0]!.id).toBe("high");
  });

  it("best objective still ranks unreachable venues last", () => {
    const candidates: ScoringCandidate[] = [
      { id: "ok", rating: 3.5, ratingCount: 50, durationsSeconds: [2400, 2400] },
      { id: "no", rating: 5, ratingCount: 9000, durationsSeconds: [600, null] },
    ];
    const ranked = scoreVenues(candidates, { objective: "best" });
    expect(ranked[0]!.id).toBe("ok");
    expect(ranked.find((r) => r.id === "no")!.reachable).toBe(false);
  });

  it("returns results sorted ascending by final score", () => {
    const candidates: ScoringCandidate[] = [
      { id: "a", rating: 4, ratingCount: 100, durationsSeconds: [600, 600] },
      { id: "b", rating: 4, ratingCount: 100, durationsSeconds: [1200, 1200] },
      { id: "c", rating: 4, ratingCount: 100, durationsSeconds: [1800, 1800] },
    ];
    const ranked = scoreVenues(candidates, { objective: "min_total" });
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i]!.finalScore).toBeGreaterThanOrEqual(ranked[i - 1]!.finalScore);
    }
  });
});
