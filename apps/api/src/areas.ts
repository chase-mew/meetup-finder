import {
  type LatLng,
  type Objective,
  type Origin,
  type TransitPreferences,
  type TravelMode,
  haversineMeters,
  maxSeconds,
  objectiveCost,
  weightedGeometricMedian,
} from "@meetup/core";
import type { TravelProvider } from "@meetup/providers";
import stationsData from "./data/london-stations.json";

interface Station {
  name: string;
  lat: number;
  lng: number;
  lines: number;
}

const STATIONS = stationsData as Station[];

export interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface MeetingArea {
  center: LatLng;
  objectiveCostSeconds: number;
}

export interface AreaFinderConfig {
  /** Grid resolution: gridSize x gridSize points across the bounding box. */
  gridSize: number;
  /** Hard cap on anchor points regardless of group size. */
  maxAnchors: number;
  /** Budget for the stage one matrix: roughly people x anchors. */
  matrixElementBudget: number;
  /** How many distinct meeting areas to return. */
  maxAreas: number;
  /** Minimum distance between two returned areas, so they are distinct. */
  areaSeparationMeters: number;
}

export const DEFAULT_AREA_CONFIG: AreaFinderConfig = {
  gridSize: 6,
  maxAnchors: 160,
  matrixElementBudget: 400,
  maxAreas: 4,
  areaSeparationMeters: 1_500,
};

// Minimum bounding box spans so a tight cluster still gets a useful grid.
// Latitude: ~0.012 deg is roughly 1.3 km. Longitude is compressed at London's
// latitude, so it needs a larger span in degrees for a similar distance.
const MIN_LAT_SPAN = 0.012;
const MIN_LNG_SPAN = 0.018;

function expandToMinSpan(min: number, max: number, minSpan: number): [number, number] {
  const span = max - min;
  if (span >= minSpan) {
    return [min, max];
  }
  const center = (min + max) / 2;
  return [center - minSpan / 2, center + minSpan / 2];
}

/** Axis aligned box covering the points, expanded by a padding fraction. */
export function boundingBox(points: LatLng[], padFraction = 0.15): BoundingBox {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  }
  [minLat, maxLat] = expandToMinSpan(minLat, maxLat, MIN_LAT_SPAN);
  [minLng, maxLng] = expandToMinSpan(minLng, maxLng, MIN_LNG_SPAN);

  const latPad = (maxLat - minLat) * padFraction;
  const lngPad = (maxLng - minLng) * padFraction;
  return {
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
    minLng: minLng - lngPad,
    maxLng: maxLng + lngPad,
  };
}

/** Build an n by n grid of points spanning the bounding box. */
export function buildGrid(bbox: BoundingBox, n: number): LatLng[] {
  if (n < 1) {
    return [];
  }
  if (n === 1) {
    return [{ lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2 }];
  }
  const points: LatLng[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      points.push({
        lat: bbox.minLat + ((bbox.maxLat - bbox.minLat) * i) / (n - 1),
        lng: bbox.minLng + ((bbox.maxLng - bbox.minLng) * j) / (n - 1),
      });
    }
  }
  return points;
}

/** Drop points that sit within `minSepMeters` of an already kept point. */
export function dedupePoints(points: LatLng[], minSepMeters: number): LatLng[] {
  const kept: LatLng[] = [];
  for (const point of points) {
    if (kept.every((k) => haversineMeters(k, point) >= minSepMeters)) {
      kept.push(point);
    }
  }
  return kept;
}

// The three base objectives averaged together for the "best" objective.
const BASE_OBJECTIVES = ["min_total", "min_max", "min_variance"] as const;

function normalizeAcross(values: number[]): number[] {
  if (values.length === 0) {
    return values;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return values.map((v) => (span > 0 ? (v - min) / span : 0));
}

/**
 * A sort key per anchor where lower is better. For a single objective this is
 * just that objective in seconds. For "best" we normalise each of the three
 * base objectives across the anchors and average them, mirroring the venue
 * scorer so area finding and final ranking agree on what "best" means.
 */
function anchorSortKeys(objective: Objective, durationsPerAnchor: number[][]): number[] {
  if (objective === "best") {
    const components = BASE_OBJECTIVES.map((base) =>
      normalizeAcross(durationsPerAnchor.map((times) => objectiveCost(base, times))),
    );
    return durationsPerAnchor.map(
      (_, i) => components.reduce((acc, component) => acc + component[i]!, 0) / components.length,
    );
  }
  return durationsPerAnchor.map((times) => objectiveCost(objective, times));
}

function stationsInBox(bbox: BoundingBox): Station[] {
  return STATIONS.filter(
    (s) =>
      s.lat >= bbox.minLat &&
      s.lat <= bbox.maxLat &&
      s.lng >= bbox.minLng &&
      s.lng <= bbox.maxLng,
  );
}

/**
 * Build the candidate anchor points for area finding: the weighted geometric
 * median, a dense grid for coverage, and (for transit only) London transit
 * stations (interchanges first) to capture transport hubs that a plain grid
 * would miss. Stations are not meaningful anchors for driving or walking, so
 * they are only added when `mode === "transit"`. The set is deduplicated and
 * capped to a matrix budget that scales with group size.
 */
export function buildAnchors(
  origins: Origin[],
  config: AreaFinderConfig,
  mode: TravelMode,
): LatLng[] {
  if (origins.length === 0) {
    return [];
  }
  const locations = origins.map((o) => o.location);
  const median = weightedGeometricMedian(
    locations,
    origins.map((o) => o.weight ?? 1),
  );
  const bbox = boundingBox([...locations, median]);
  const grid = buildGrid(bbox, config.gridSize);
  const stations =
    mode === "transit"
      ? stationsInBox(bbox)
          .slice()
          .sort((a, b) => b.lines - a.lines)
          .map((s) => ({ lat: s.lat, lng: s.lng }))
      : [];

  const anchors = dedupePoints([median, ...grid, ...stations], 150);

  const peopleCount = Math.max(1, origins.length);
  const budgetCap = Math.max(1, Math.floor(config.matrixElementBudget / peopleCount));
  const cap = Math.min(config.maxAnchors, budgetCap);
  return anchors.slice(0, cap);
}

/**
 * Stage one of the search: find the best meeting areas by real travel time.
 *
 * Scores every anchor by the chosen fairness objective using a transit matrix
 * from each person, then returns up to `maxAreas` spatially distinct winners.
 * This is what lets the result sit at a well connected hub off to the side,
 * rather than always near the geographic centre.
 */
export async function findMeetingAreas(
  travel: TravelProvider,
  origins: Origin[],
  mode: TravelMode,
  objective: Objective,
  config: AreaFinderConfig = DEFAULT_AREA_CONFIG,
  transit?: TransitPreferences,
): Promise<MeetingArea[]> {
  if (origins.length === 0) {
    return [];
  }
  const anchors = buildAnchors(origins, config, mode);
  if (anchors.length === 0) {
    return [];
  }

  const matrix = await travel.matrix({
    origins: origins.map((o) => o.location),
    destinations: anchors,
    mode,
    transit,
  });

  const durations: Array<Array<number | null>> = anchors.map(() => origins.map(() => null));
  for (const cell of matrix.cells) {
    if (
      cell.destinationIndex >= 0 &&
      cell.destinationIndex < anchors.length &&
      cell.originIndex >= 0 &&
      cell.originIndex < origins.length
    ) {
      durations[cell.destinationIndex]![cell.originIndex] = cell.durationSeconds;
    }
  }

  const reachableItems = anchors
    .map((center, index) => {
      const times = durations[index]!;
      const reachable =
        times.length > 0 && times.every((t) => t !== null && Number.isFinite(t));
      return { center, times: times as number[], reachable };
    })
    .filter((item) => item.reachable);

  if (reachableItems.length === 0) {
    return [];
  }

  const sortKeys = anchorSortKeys(
    objective,
    reachableItems.map((item) => item.times),
  );
  const ranked = reachableItems
    .map((item, i) => ({
      center: item.center,
      sortKey: sortKeys[i]!,
      objectiveCostSeconds:
        objective === "best" ? maxSeconds(item.times) : objectiveCost(objective, item.times),
    }))
    .sort((a, b) => a.sortKey - b.sortKey);

  // Non maximum suppression: take the best, then skip anything too close to it.
  const selected: MeetingArea[] = [];
  for (const candidate of ranked) {
    const farEnough = selected.every(
      (area) => haversineMeters(area.center, candidate.center) >= config.areaSeparationMeters,
    );
    if (farEnough) {
      selected.push({
        center: candidate.center,
        objectiveCostSeconds: candidate.objectiveCostSeconds,
      });
      if (selected.length >= config.maxAreas) {
        break;
      }
    }
  }

  return selected;
}
