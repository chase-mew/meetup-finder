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

export interface Station {
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
  gridSize: 10,
  maxAnchors: 320,
  matrixElementBudget: 800,
  maxAreas: 4,
  areaSeparationMeters: 1_500,
};

/**
 * Fraction of the anchor cap reserved for stations when the grid would
 * otherwise consume the whole budget. With a fixed 10 by 10 grid (100 points)
 * a large group can drive the cap below the grid size, so without a reserve the
 * grid alone would crowd stations out entirely. This guarantees a spread set of
 * major interchanges survives even for groups up to 10 people.
 */
const STATION_RESERVE_FRACTION = 0.35;

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
 * Take `count` items spread evenly across a 1D list, keeping the first and last
 * so the full extent is covered. Used to choose evenly spaced row and column
 * indices for {@link thinGrid} and to spread a small leftover backfill.
 */
export function subsampleEven<T>(points: T[], count: number): T[] {
  if (count <= 0) {
    return [];
  }
  if (count >= points.length) {
    return points.slice();
  }
  if (count === 1) {
    return [points[0]!];
  }
  const out: T[] = [];
  for (let k = 0; k < count; k += 1) {
    const index = Math.round((k * (points.length - 1)) / (count - 1));
    out.push(points[index]!);
  }
  return out;
}

/**
 * Thin a row-major `n x n` grid down to at most `count` points while staying
 * spatially even in both dimensions. Subsampling the flattened array would walk
 * a diagonal and leave whole corners of the box bare, so instead we keep an
 * evenly spaced subset of rows and columns (a coarser rectangular sub-grid),
 * which preserves coverage across the full box. Expects the untrimmed grid from
 * {@link buildGrid} so the `row * n + col` indexing is valid.
 */
export function thinGrid(grid: LatLng[], n: number, count: number): LatLng[] {
  if (count <= 0 || grid.length === 0) {
    return [];
  }
  if (count >= grid.length || n < 2) {
    return grid.slice(0, count >= grid.length ? grid.length : count);
  }
  const ratio = Math.sqrt(count / (n * n));
  const rows = Math.min(n, Math.max(1, Math.round(n * ratio)));
  const cols = Math.min(n, Math.max(1, Math.floor(count / rows)));
  const axis = [...Array(n).keys()];
  const rowIndices = subsampleEven(axis, rows);
  const colIndices = subsampleEven(axis, cols);
  const out: LatLng[] = [];
  for (const r of rowIndices) {
    for (const c of colIndices) {
      const point = grid[r * n + c];
      if (point) {
        out.push(point);
      }
    }
  }
  return out;
}

/**
 * Pick up to `limit` stations that are both important (many lines) and spatially
 * spread, mirroring the area non maximum suppression used for the final areas.
 *
 * Greedy weighted farthest point: seed with the most important station, then
 * repeatedly take the station that maximises `importance x distance to the
 * nearest already kept point`. That keeps the major interchanges while refusing
 * to pile several nearby hubs into the set and leave gaps elsewhere. Candidates
 * within `minSepMeters` of an already kept point (a grid anchor or a previously
 * picked station) are skipped, so the 150 m dedupe still holds.
 */
export function selectSpreadStations(
  stations: Station[],
  limit: number,
  keepClearOf: LatLng[],
  minSepMeters: number,
): LatLng[] {
  if (limit <= 0) {
    return [];
  }
  // Drop stations that collide with an already kept anchor (e.g. a grid point).
  const remaining = stations.filter((s) =>
    keepClearOf.every((k) => haversineMeters(k, s) >= minSepMeters),
  );
  if (remaining.length === 0) {
    return [];
  }

  const importance = (s: Station) => Math.max(1, s.lines);
  const selected: Station[] = [];

  // Seed with the most important station so interchanges anchor the spread.
  let seedIndex = 0;
  for (let i = 1; i < remaining.length; i += 1) {
    if (importance(remaining[i]!) > importance(remaining[seedIndex]!)) {
      seedIndex = i;
    }
  }
  selected.push(remaining.splice(seedIndex, 1)[0]!);

  while (selected.length < limit && remaining.length > 0) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i]!;
      let nearest = Infinity;
      for (const s of selected) {
        const distance = haversineMeters(candidate, s);
        if (distance < nearest) {
          nearest = distance;
        }
      }
      // Respect the dedupe: never keep two points within minSepMeters.
      if (nearest < minSepMeters) {
        continue;
      }
      const score = importance(candidate) * nearest;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) {
      break; // every remaining candidate is too close to a kept point
    }
    selected.push(remaining.splice(bestIndex, 1)[0]!);
  }

  return selected.map((s) => ({ lat: s.lat, lng: s.lng }));
}

/**
 * Build the candidate anchor points for area finding: the weighted geometric
 * median, a dense grid for coverage, and (for transit only) London transit
 * stations to capture transport hubs that a plain grid would miss. Stations are
 * not meaningful anchors for driving or walking, so they are only added when
 * `mode === "transit"`.
 *
 * The set is capped to a matrix budget that scales with group size. Because the
 * grid is a fixed 10 by 10 (100 points), a large group can push the cap below
 * the grid size, so the cap is split: the median is always kept, a reserved
 * share goes to a geographically spread, importance-weighted set of stations,
 * and the grid fills the rest, thinned with even 2D coverage when it overflows.
 * This stops a dense grid from starving stations for groups up to 10 people.
 * Slots either pool leaves unused (a short grid, or stations lost to dedupe) are
 * handed to the other. The 150 m dedupe applies throughout and the total never
 * exceeds the cap.
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

  const peopleCount = Math.max(1, origins.length);
  const budgetCap = Math.max(1, Math.floor(config.matrixElementBudget / peopleCount));
  const cap = Math.min(config.maxAnchors, budgetCap);

  // The median always takes the first slot.
  const kept: LatLng[] = [median];
  if (cap <= 1) {
    return kept;
  }

  const fullGrid = buildGrid(bbox, config.gridSize);
  const stationCandidates =
    mode === "transit" ? stationsInBox(bbox).slice().sort((a, b) => b.lines - a.lines) : [];

  // Split the remaining cap (after the median) between grid and stations. With
  // no stations the grid takes everything; otherwise reserve a fair share for
  // stations so a large grid cannot crowd them out.
  const remainingSlots = cap - 1;
  const stationTarget =
    stationCandidates.length > 0
      ? Math.min(remainingSlots, Math.round(cap * STATION_RESERVE_FRACTION))
      : 0;
  const gridTarget = remainingSlots - stationTarget;

  // Grid: thin to the target with even 2D coverage, then drop any point that
  // collides with the median so the 150 m dedupe holds.
  for (const point of thinGrid(fullGrid, config.gridSize, gridTarget)) {
    if (kept.every((k) => haversineMeters(k, point) >= 150)) {
      kept.push(point);
    }
  }

  // Stations: fill up to whatever is actually left, so a grid that came in
  // under its target hands the spare slots back to stations.
  if (stationCandidates.length > 0) {
    const stationLimit = cap - kept.length;
    if (stationLimit > 0) {
      kept.push(...selectSpreadStations(stationCandidates, stationLimit, kept, 150));
    }
  }

  // Reclaim any station slots that dedupe left unused with more grid coverage,
  // so a search never returns under the cap while grid anchors remain.
  const spareSlots = cap - kept.length;
  if (spareSlots > 0) {
    const leftover = fullGrid.filter((point) =>
      kept.every((k) => haversineMeters(k, point) >= 150),
    );
    kept.push(...subsampleEven(leftover, spareSlots));
  }

  return kept.slice(0, cap);
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
