import { haversineMeters, type Origin } from "@meetup/core";
import type { TravelMatrixRequest, TravelProvider } from "@meetup/providers";
import { describe, expect, it, vi } from "vitest";
import {
  type AreaFinderConfig,
  DEFAULT_AREA_CONFIG,
  boundingBox,
  buildAnchors,
  buildGrid,
  dedupePoints,
  findMeetingAreas,
} from "./areas";

describe("boundingBox", () => {
  it("covers the points and enforces a minimum span", () => {
    const box = boundingBox([
      { lat: 51.5, lng: -0.12 },
      { lat: 51.5005, lng: -0.1205 },
    ]);
    expect(box.minLat).toBeLessThan(51.5);
    expect(box.maxLat).toBeGreaterThan(51.5005);
    // The tiny cluster is widened so a grid is still meaningful.
    expect(box.maxLat - box.minLat).toBeGreaterThanOrEqual(0.012);
  });
});

describe("buildGrid", () => {
  it("creates an n by n grid spanning the box", () => {
    const box = { minLat: 0, minLng: 0, maxLat: 1, maxLng: 1 };
    const grid = buildGrid(box, 3);
    expect(grid).toHaveLength(9);
    expect(grid).toContainEqual({ lat: 0, lng: 0 });
    expect(grid).toContainEqual({ lat: 1, lng: 1 });
  });
});

describe("dedupePoints", () => {
  it("drops points within the separation distance", () => {
    const points = [
      { lat: 51.5, lng: -0.12 },
      { lat: 51.50001, lng: -0.12001 }, // a few metres away
      { lat: 51.52, lng: -0.12 },
    ];
    expect(dedupePoints(points, 150)).toHaveLength(2);
  });
});

describe("buildAnchors", () => {
  const origins: Origin[] = [
    { id: "a", location: { lat: 51.5308, lng: -0.1238 } },
    { id: "b", location: { lat: 51.5036, lng: -0.1144 } },
  ];

  // A config without the matrix budget cap so every candidate anchor survives,
  // letting us compare the full station-aware anchor sets across modes.
  const uncappedConfig: AreaFinderConfig = {
    ...DEFAULT_AREA_CONFIG,
    matrixElementBudget: Number.MAX_SAFE_INTEGER,
  };

  it("includes grid points and London stations for transit, capped by the budget", () => {
    const anchors = buildAnchors(origins, DEFAULT_AREA_CONFIG, "transit");
    expect(anchors.length).toBeGreaterThan(DEFAULT_AREA_CONFIG.gridSize); // more than a sparse set
    const budgetCap = Math.floor(DEFAULT_AREA_CONFIG.matrixElementBudget / origins.length);
    expect(anchors.length).toBeLessThanOrEqual(Math.min(DEFAULT_AREA_CONFIG.maxAnchors, budgetCap));
  });

  it("includes station anchors for transit", () => {
    const transit = buildAnchors(origins, uncappedConfig, "transit");
    const walking = buildAnchors(origins, uncappedConfig, "walking");
    // Transit adds stations on top of the grid plus median, so it has strictly
    // more anchors than the station-free walking set for this cluster.
    expect(transit.length).toBeGreaterThan(walking.length);
  });

  it("excludes station anchors for driving and walking", () => {
    const driving = buildAnchors(origins, uncappedConfig, "driving");
    const walking = buildAnchors(origins, uncappedConfig, "walking");
    // Without stations the anchors are just the median plus the deduped grid,
    // which is identical regardless of the non-transit mode.
    expect(driving).toEqual(walking);
    expect(driving.length).toBeLessThanOrEqual(DEFAULT_AREA_CONFIG.gridSize ** 2 + 1);
  });
});

// Travel time proportional to straight line distance.
function fakeTravel(): TravelProvider {
  return {
    matrix: vi.fn(async (req: TravelMatrixRequest) => {
      const cells = [];
      for (let oi = 0; oi < req.origins.length; oi += 1) {
        for (let di = 0; di < req.destinations.length; di += 1) {
          const meters = haversineMeters(req.origins[oi]!, req.destinations[di]!);
          cells.push({
            originIndex: oi,
            destinationIndex: di,
            durationSeconds: Math.round(meters / 5),
            distanceMeters: Math.round(meters),
          });
        }
      }
      return { origins: req.origins.length, destinations: req.destinations.length, cells };
    }),
  };
}

describe("findMeetingAreas", () => {
  const origins: Origin[] = [
    { id: "a", location: { lat: 51.5308, lng: -0.1238 } },
    { id: "b", location: { lat: 51.5036, lng: -0.1144 } },
  ];

  it("returns spatially distinct areas, capped at maxAreas", async () => {
    const travel = fakeTravel();
    const areas = await findMeetingAreas(travel, origins, "transit", "best", {
      ...DEFAULT_AREA_CONFIG,
      maxAreas: 3,
    });
    expect(areas.length).toBeGreaterThan(0);
    expect(areas.length).toBeLessThanOrEqual(3);
    for (let i = 0; i < areas.length; i += 1) {
      for (let j = i + 1; j < areas.length; j += 1) {
        expect(
          haversineMeters(areas[i]!.center, areas[j]!.center),
        ).toBeGreaterThanOrEqual(DEFAULT_AREA_CONFIG.areaSeparationMeters);
      }
    }
  });

  it("puts the lowest travel cost area first", async () => {
    const travel = fakeTravel();
    const areas = await findMeetingAreas(travel, origins, "transit", "min_max", DEFAULT_AREA_CONFIG);
    expect(areas.length).toBeGreaterThan(0);
    // The best area should be reasonably central between the two origins.
    const midLat = (origins[0]!.location.lat + origins[1]!.location.lat) / 2;
    expect(Math.abs(areas[0]!.center.lat - midLat)).toBeLessThan(0.03);
  });

  it("handles the best objective without throwing", async () => {
    const travel = fakeTravel();
    const areas = await findMeetingAreas(travel, origins, "transit", "best", DEFAULT_AREA_CONFIG);
    expect(areas.length).toBeGreaterThan(0);
  });
});
