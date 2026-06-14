import { haversineMeters, type LatLng, type Origin } from "@meetup/core";
import type { TravelMatrixRequest, TravelProvider } from "@meetup/providers";
import { describe, expect, it, vi } from "vitest";
import {
  type AreaFinderConfig,
  type Station,
  DEFAULT_AREA_CONFIG,
  boundingBox,
  buildAnchors,
  buildGrid,
  dedupePoints,
  findMeetingAreas,
  selectSpreadStations,
  subsampleEven,
} from "./areas";
import stationsData from "./data/london-stations.json";

const STATIONS = stationsData as Station[];
// Stations are added verbatim, so an anchor that exactly matches a station
// coordinate is a kept station rather than a grid point.
const STATION_KEYS = new Set(STATIONS.map((s) => `${s.lat},${s.lng}`));
const countStationAnchors = (anchors: LatLng[]): number =>
  anchors.filter((a) => STATION_KEYS.has(`${a.lat},${a.lng}`)).length;

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

describe("DEFAULT_AREA_CONFIG", () => {
  it("uses the denser tuning: 10x10 grid, 800 budget, 320 max anchors", () => {
    expect(DEFAULT_AREA_CONFIG.gridSize).toBe(10);
    expect(DEFAULT_AREA_CONFIG.matrixElementBudget).toBe(800);
    expect(DEFAULT_AREA_CONFIG.maxAnchors).toBe(320);
  });
});

describe("subsampleEven", () => {
  it("returns the input when asking for at least as many points", () => {
    const points = [0, 1, 2];
    expect(subsampleEven(points, 3)).toEqual([0, 1, 2]);
    expect(subsampleEven(points, 5)).toEqual([0, 1, 2]);
  });

  it("spreads the sample across the full range, keeping the ends", () => {
    const points = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const sampled = subsampleEven(points, 5);
    expect(sampled).toHaveLength(5);
    expect(sampled[0]).toBe(0); // first kept
    expect(sampled[sampled.length - 1]).toBe(9); // last kept
    // Evenly spread rather than a head slice.
    expect(sampled).toEqual([0, 2, 5, 7, 9]);
  });

  it("handles zero and one", () => {
    expect(subsampleEven([1, 2, 3], 0)).toEqual([]);
    expect(subsampleEven([1, 2, 3], 1)).toEqual([1]);
  });
});

describe("selectSpreadStations", () => {
  // A tight cluster of major interchanges plus two minor outliers far away.
  const cluster: Station[] = [
    { name: "Hub A", lat: 51.5, lng: -0.1, lines: 6 },
    { name: "Hub B", lat: 51.5018, lng: -0.1, lines: 5 }, // ~200 m north
    { name: "Hub C", lat: 51.5, lng: -0.1029, lines: 5 }, // ~200 m west
    { name: "Hub D", lat: 51.5018, lng: -0.1029, lines: 4 },
  ];
  const farNorth: Station = { name: "Far North", lat: 51.58, lng: -0.1, lines: 2 };
  const farSouth: Station = { name: "Far South", lat: 51.42, lng: -0.1, lines: 2 };
  const stations = [...cluster, farNorth, farSouth];

  it("seeds with the most important station (line count)", () => {
    const picked = selectSpreadStations(stations, 1, [], 150);
    expect(picked).toEqual([{ lat: 51.5, lng: -0.1 }]); // Hub A, 6 lines
  });

  it("spreads geographically instead of keeping a cluster of nearby hubs", () => {
    const picked = selectSpreadStations(stations, 3, [], 150);
    expect(picked).toHaveLength(3);
    // The major hub anchors the set, then the two far outliers win on spread.
    expect(picked).toContainEqual({ lat: 51.5, lng: -0.1 });
    expect(picked).toContainEqual({ lat: farNorth.lat, lng: farNorth.lng });
    expect(picked).toContainEqual({ lat: farSouth.lat, lng: farSouth.lng });
  });

  it("skips stations within the dedupe distance of an already kept point", () => {
    // A grid point sitting on Hub A should remove it from the candidates.
    const keepClearOf: LatLng[] = [{ lat: 51.5, lng: -0.1 }];
    const picked = selectSpreadStations(stations, 6, keepClearOf, 150);
    expect(picked).not.toContainEqual({ lat: 51.5, lng: -0.1 });
    for (const p of picked) {
      expect(haversineMeters(p, keepClearOf[0]!)).toBeGreaterThanOrEqual(150);
    }
  });

  it("never keeps two picks within the dedupe distance", () => {
    const picked = selectSpreadStations(stations, 6, [], 150);
    for (let i = 0; i < picked.length; i += 1) {
      for (let j = i + 1; j < picked.length; j += 1) {
        expect(haversineMeters(picked[i]!, picked[j]!)).toBeGreaterThanOrEqual(150);
      }
    }
  });
});

describe("buildAnchors", () => {
  const origins: Origin[] = [
    { id: "a", location: { lat: 51.5308, lng: -0.1238 } },
    { id: "b", location: { lat: 51.5036, lng: -0.1144 } },
  ];

  // Ten people spread across a wide swathe of London, so the bounding box is
  // large and the matrix budget bites hard (the grid alone exceeds the cap).
  const wideOrigins: Origin[] = [
    { id: "p0", location: { lat: 51.5762, lng: -0.0982 } }, // north
    { id: "p1", location: { lat: 51.4613, lng: -0.1156 } }, // south (Brixton)
    { id: "p2", location: { lat: 51.5101, lng: 0.0 } }, // east
    { id: "p3", location: { lat: 51.4925, lng: -0.2226 } }, // west (Hammersmith)
    { id: "p4", location: { lat: 51.5074, lng: -0.1278 } }, // centre
    { id: "p5", location: { lat: 51.5454, lng: -0.1729 } }, // north west
    { id: "p6", location: { lat: 51.4769, lng: -0.0005 } }, // south east (Greenwich)
    { id: "p7", location: { lat: 51.5388, lng: -0.1426 } }, // Camden
    { id: "p8", location: { lat: 51.4839, lng: -0.1685 } }, // Chelsea
    { id: "p9", location: { lat: 51.5246, lng: -0.0757 } }, // Shoreditch
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
    expect(countStationAnchors(driving)).toBe(0);
  });

  it("never exceeds the cap and keeps the 150 m dedupe", () => {
    const anchors = buildAnchors(wideOrigins, DEFAULT_AREA_CONFIG, "transit");
    const budgetCap = Math.floor(DEFAULT_AREA_CONFIG.matrixElementBudget / wideOrigins.length);
    const cap = Math.min(DEFAULT_AREA_CONFIG.maxAnchors, budgetCap);
    expect(anchors.length).toBeLessThanOrEqual(cap);
    for (let i = 0; i < anchors.length; i += 1) {
      for (let j = i + 1; j < anchors.length; j += 1) {
        expect(haversineMeters(anchors[i]!, anchors[j]!)).toBeGreaterThanOrEqual(150);
      }
    }
  });

  it("reserves spread stations for a large group instead of a grid-only set", () => {
    // 10 people: cap = min(320, floor(800 / 10) = 80) = 80, which is below the
    // 100-point grid. The old "[median, grid, stations]" slice would truncate
    // the grid and keep zero stations; the reserve keeps a spread station set.
    const transit = buildAnchors(wideOrigins, DEFAULT_AREA_CONFIG, "transit");
    const walking = buildAnchors(wideOrigins, DEFAULT_AREA_CONFIG, "walking");

    expect(walking.length).toBeLessThanOrEqual(80);
    expect(countStationAnchors(walking)).toBe(0); // non-transit never adds stations

    const stationAnchors = transit.filter((a) => STATION_KEYS.has(`${a.lat},${a.lng}`));
    // Stations are not crowded out: a healthy reserved share survives.
    expect(stationAnchors.length).toBeGreaterThanOrEqual(15);
    // ...and they are geographically spread, not a single cluster.
    let maxPairwise = 0;
    for (let i = 0; i < stationAnchors.length; i += 1) {
      for (let j = i + 1; j < stationAnchors.length; j += 1) {
        maxPairwise = Math.max(maxPairwise, haversineMeters(stationAnchors[i]!, stationAnchors[j]!));
      }
    }
    expect(maxPairwise).toBeGreaterThan(8_000);
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
