import { describe, expect, it } from "vitest";
import {
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
