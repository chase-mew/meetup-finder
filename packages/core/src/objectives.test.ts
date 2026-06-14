import { describe, expect, it } from "vitest";
import {
  BEST_OBJECTIVES,
  BEST_OBJECTIVE_WEIGHTS,
  blendBestCost,
  maxSeconds,
  meanSeconds,
  objectiveCost,
  totalSeconds,
  varianceSeconds,
} from "./objectives";

describe("basic statistics", () => {
  const durations = [600, 1200, 1800];

  it("totals durations", () => {
    expect(totalSeconds(durations)).toBe(3600);
  });

  it("finds the maximum", () => {
    expect(maxSeconds(durations)).toBe(1800);
  });

  it("computes the mean", () => {
    expect(meanSeconds(durations)).toBe(1200);
  });

  it("computes population variance", () => {
    // mean 1200, deviations -600, 0, 600 => (360000+0+360000)/3 = 240000
    expect(varianceSeconds(durations)).toBeCloseTo(240_000, 6);
  });

  it("handles empty input gracefully", () => {
    expect(totalSeconds([])).toBe(0);
    expect(maxSeconds([])).toBe(0);
    expect(meanSeconds([])).toBe(0);
    expect(varianceSeconds([])).toBe(0);
  });
});

describe("objectiveCost", () => {
  const durations = [600, 1200, 1800];

  it("min_total returns the sum", () => {
    expect(objectiveCost("min_total", durations)).toBe(3600);
  });

  it("min_max returns the worst case", () => {
    expect(objectiveCost("min_max", durations)).toBe(1800);
  });

  it("min_variance returns the standard deviation", () => {
    expect(objectiveCost("min_variance", durations)).toBeCloseTo(Math.sqrt(240_000), 6);
  });

  it("prefers the fairer option under min_max", () => {
    const fair = [1000, 1000, 1000];
    const unfair = [200, 200, 2600];
    expect(objectiveCost("min_max", fair)).toBeLessThan(objectiveCost("min_max", unfair));
  });

  it("prefers the most even option under min_variance", () => {
    const even = [1000, 1000, 1000];
    const uneven = [200, 1000, 1800];
    expect(objectiveCost("min_variance", even)).toBeLessThan(
      objectiveCost("min_variance", uneven),
    );
  });
});

describe("best objective blend", () => {
  it("lists the base objectives in the order the weights expect", () => {
    expect(BEST_OBJECTIVES).toEqual(["min_total", "min_max", "min_variance"]);
    expect(BEST_OBJECTIVE_WEIGHTS).toHaveLength(BEST_OBJECTIVES.length);
  });

  it("weights both fairness measures above raw efficiency", () => {
    const [total, max, variance] = BEST_OBJECTIVE_WEIGHTS;
    // min_total (efficiency) is only a tie-breaker; the worst trip and evenness
    // carry the decision, so each of them outweighs efficiency.
    expect(max).toBeGreaterThan(total!);
    expect(variance).toBeGreaterThan(total!);
  });

  it("blends each component by its normalised weight", () => {
    const sum = BEST_OBJECTIVE_WEIGHTS.reduce((acc, w) => acc + w, 0);
    // A unit cost on a single objective returns that objective's share of the
    // total weight, so efficiency contributes the least and fairness the most.
    expect(blendBestCost([1, 0, 0])).toBeCloseTo(BEST_OBJECTIVE_WEIGHTS[0]! / sum, 10);
    expect(blendBestCost([0, 1, 0])).toBeCloseTo(BEST_OBJECTIVE_WEIGHTS[1]! / sum, 10);
    expect(blendBestCost([0, 0, 1])).toBeCloseTo(BEST_OBJECTIVE_WEIGHTS[2]! / sum, 10);
    expect(blendBestCost([1, 0, 0])).toBeLessThan(blendBestCost([0, 1, 0]));
    expect(blendBestCost([1, 0, 0])).toBeLessThan(blendBestCost([0, 0, 1]));
  });

  it("returns 0 and 1 at the extremes regardless of weight scale", () => {
    expect(blendBestCost([0, 0, 0])).toBe(0);
    expect(blendBestCost([1, 1, 1])).toBeCloseTo(1, 10);
  });
});
