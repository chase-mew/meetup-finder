import { describe, expect, it } from "vitest";
import {
  centroid,
  haversineMeters,
  selectNearest,
  weightedGeometricMedian,
} from "./geo";
import type { LatLng } from "./types";

const KINGS_CROSS: LatLng = { lat: 51.5308, lng: -0.1238 };
const WATERLOO: LatLng = { lat: 51.5036, lng: -0.1144 };

describe("haversineMeters", () => {
  it("returns zero for identical points", () => {
    expect(haversineMeters(KINGS_CROSS, KINGS_CROSS)).toBe(0);
  });

  it("is symmetric", () => {
    const ab = haversineMeters(KINGS_CROSS, WATERLOO);
    const ba = haversineMeters(WATERLOO, KINGS_CROSS);
    expect(ab).toBeCloseTo(ba, 6);
  });

  it("matches a known London distance within tolerance", () => {
    // King's Cross to Waterloo is roughly 3.1 km in a straight line.
    const distance = haversineMeters(KINGS_CROSS, WATERLOO);
    expect(distance).toBeGreaterThan(2_900);
    expect(distance).toBeLessThan(3_300);
  });
});

describe("centroid", () => {
  it("averages the coordinates", () => {
    const c = centroid([
      { lat: 0, lng: 0 },
      { lat: 2, lng: 4 },
    ]);
    expect(c.lat).toBeCloseTo(1, 9);
    expect(c.lng).toBeCloseTo(2, 9);
  });

  it("throws on empty input", () => {
    expect(() => centroid([])).toThrow();
  });
});

describe("weightedGeometricMedian", () => {
  it("returns the only point for a single input", () => {
    const median = weightedGeometricMedian([KINGS_CROSS]);
    expect(median.lat).toBeCloseTo(KINGS_CROSS.lat, 9);
    expect(median.lng).toBeCloseTo(KINGS_CROSS.lng, 9);
  });

  it("sits near the centre for symmetric points", () => {
    const points: LatLng[] = [
      { lat: 51.5, lng: -0.2 },
      { lat: 51.5, lng: 0.0 },
      { lat: 51.5, lng: 0.2 },
    ];
    const median = weightedGeometricMedian(points);
    expect(median.lat).toBeCloseTo(51.5, 3);
    expect(median.lng).toBeCloseTo(0.0, 2);
  });

  it("shifts toward the more heavily weighted point", () => {
    const points: LatLng[] = [
      { lat: 51.5, lng: -0.3 },
      { lat: 51.5, lng: 0.3 },
    ];
    const balanced = weightedGeometricMedian(points, [1, 1]);
    const skewed = weightedGeometricMedian(points, [1, 9]);
    expect(balanced.lng).toBeCloseTo(0, 2);
    expect(skewed.lng).toBeGreaterThan(balanced.lng);
  });
});

describe("selectNearest", () => {
  it("returns the k closest items nearest first", () => {
    const items = [
      { id: "far", location: { lat: 52.5, lng: -0.1 } },
      { id: "near", location: { lat: 51.531, lng: -0.124 } },
      { id: "mid", location: { lat: 51.6, lng: -0.1 } },
    ];
    const nearest = selectNearest(KINGS_CROSS, items, 2, (i) => i.location);
    expect(nearest.map((i) => i.id)).toEqual(["near", "mid"]);
  });

  it("handles k larger than the list", () => {
    const items = [{ id: "a", location: KINGS_CROSS }];
    expect(selectNearest(KINGS_CROSS, items, 5, (i) => i.location)).toHaveLength(1);
  });
});
