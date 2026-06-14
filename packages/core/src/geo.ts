import type { LatLng } from "./types";

const EARTH_RADIUS_METERS = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great circle distance between two points in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Simple arithmetic mean of points. Adequate at city scale. */
export function centroid(points: LatLng[]): LatLng {
  if (points.length === 0) {
    throw new Error("centroid requires at least one point");
  }
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}

export interface GeometricMedianOptions {
  /** Maximum iterations before returning the best estimate. */
  maxIterations?: number;
  /** Stop when the step moves less than this many metres. */
  toleranceMeters?: number;
}

/**
 * Weighted geometric median via Weiszfeld's algorithm.
 *
 * Returns the point that minimises the weighted sum of distances to the inputs.
 * This is a cheap, network free seed for where to search for venues.
 */
export function weightedGeometricMedian(
  points: LatLng[],
  weights?: number[],
  options: GeometricMedianOptions = {},
): LatLng {
  if (points.length === 0) {
    throw new Error("weightedGeometricMedian requires at least one point");
  }
  if (points.length === 1) {
    return { ...points[0]! };
  }

  const w = points.map((_, i) => weights?.[i] ?? 1);
  const maxIterations = options.maxIterations ?? 200;
  const toleranceMeters = options.toleranceMeters ?? 1;

  // Seed with the weighted centroid.
  let current = weightedCentroid(points, w);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let numLat = 0;
    let numLng = 0;
    let denom = 0;
    let coincident: LatLng | null = null;

    for (let i = 0; i < points.length; i += 1) {
      const p = points[i]!;
      const distance = haversineMeters(current, p);
      if (distance < 1e-6) {
        coincident = p;
        break;
      }
      const factor = w[i]! / distance;
      numLat += p.lat * factor;
      numLng += p.lng * factor;
      denom += factor;
    }

    // The estimate sits exactly on an input point; that point is the median.
    if (coincident) {
      return { ...coincident };
    }
    if (denom === 0) {
      return current;
    }

    const next: LatLng = { lat: numLat / denom, lng: numLng / denom };
    const moved = haversineMeters(current, next);
    current = next;
    if (moved < toleranceMeters) {
      break;
    }
  }

  return current;
}

function weightedCentroid(points: LatLng[], weights: number[]): LatLng {
  let lat = 0;
  let lng = 0;
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const weight = weights[i] ?? 1;
    lat += points[i]!.lat * weight;
    lng += points[i]!.lng * weight;
    total += weight;
  }
  if (total === 0) {
    return centroid(points);
  }
  return { lat: lat / total, lng: lng / total };
}

/**
 * Return the `k` items whose location is closest to `from`, nearest first.
 * Used to prune the candidate venue set before the expensive travel matrix.
 */
export function selectNearest<T>(
  from: LatLng,
  items: T[],
  k: number,
  getLocation: (item: T) => LatLng,
): T[] {
  return [...items]
    .map((item) => ({ item, distance: haversineMeters(from, getLocation(item)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.max(0, k))
    .map((entry) => entry.item);
}
