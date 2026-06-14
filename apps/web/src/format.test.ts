import { describe, expect, it } from "vitest";
import {
  formatDistance,
  formatDuration,
  formatPriceLevel,
  formatRating,
  formatRatingCount,
} from "./format";

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(30)).toBe("under 1 min");
    expect(formatDuration(600)).toBe("10 min");
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(3900)).toBe("1 h 5 min");
  });

  it("handles missing values", () => {
    expect(formatDuration(null)).toBe("no route");
    expect(formatDuration(undefined)).toBe("no route");
  });
});

describe("formatDistance", () => {
  it("uses metres then kilometres", () => {
    expect(formatDistance(800)).toBe("800 m");
    expect(formatDistance(1500)).toBe("1.5 km");
    expect(formatDistance(null)).toBe("");
  });
});

describe("formatPriceLevel", () => {
  it("renders pound signs", () => {
    expect(formatPriceLevel(0)).toBe("");
    expect(formatPriceLevel(2)).toBe("££");
    expect(formatPriceLevel(9)).toBe("££££");
  });
});

describe("formatRating", () => {
  it("formats to one decimal", () => {
    expect(formatRating(4.567)).toBe("4.6");
    expect(formatRating(undefined)).toBe("No rating");
  });
});

describe("formatRatingCount", () => {
  it("abbreviates thousands", () => {
    expect(formatRatingCount(500)).toBe("500");
    expect(formatRatingCount(1500)).toBe("1.5k");
    expect(formatRatingCount(12000)).toBe("12k");
    expect(formatRatingCount(0)).toBe("");
  });
});
