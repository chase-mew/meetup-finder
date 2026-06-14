import type { LatLng } from "@meetup/core";

/**
 * A person the user has saved for quick reuse: a name plus an already resolved
 * location, so inserting one into a search needs no further geocoding.
 */
export interface Favourite {
  id: string;
  label: string;
  address: string;
  location: LatLng;
  resolvedAddress?: string;
}

const STORAGE_KEY = "favourites";

/**
 * Two favourites within this distance are treated as the same place, so the
 * same person saved under a slightly different name is not stored twice.
 */
const DUPLICATE_DISTANCE_METRES = 50;

const EARTH_RADIUS_METRES = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Approximate great-circle distance, good enough for a proximity check. */
function distanceMetres(a: LatLng, b: LatLng): number {
  const meanLat = toRadians((a.lat + b.lat) / 2);
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng) * Math.cos(meanLat);
  return Math.sqrt(dLat * dLat + dLng * dLng) * EARTH_RADIUS_METRES;
}

/** Lower-case, trim, and collapse internal whitespace for name comparison. */
export function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

interface FavouriteKey {
  label: string;
  location: LatLng;
}

/** True when two favourites refer to the same person, by name or by proximity. */
export function isSameFavourite(a: FavouriteKey, b: FavouriteKey): boolean {
  const nameA = normaliseName(a.label);
  const nameB = normaliseName(b.label);
  if (nameA.length > 0 && nameA === nameB) {
    return true;
  }
  return distanceMetres(a.location, b.location) <= DUPLICATE_DISTANCE_METRES;
}

/**
 * Add a favourite, replacing any existing duplicate in place so the same person
 * is never stored twice. A replacement keeps the original id for stable keys.
 */
export function upsertFavourite(list: Favourite[], incoming: Favourite): Favourite[] {
  const index = list.findIndex((existing) => isSameFavourite(existing, incoming));
  if (index === -1) {
    return [...list, incoming];
  }
  return list
    .map((existing, i) => (i === index ? { ...incoming, id: existing.id } : existing))
    .filter((existing, i) => i === index || !isSameFavourite(existing, incoming));
}

/** Remove a favourite by id. */
export function removeFavourite(list: Favourite[], id: string): Favourite[] {
  return list.filter((favourite) => favourite.id !== id);
}

/** Find a saved favourite matching the given name and location, if any. */
export function findFavourite(list: Favourite[], candidate: FavouriteKey): Favourite | undefined {
  return list.find((favourite) => isSameFavourite(favourite, candidate));
}

function isLatLng(value: unknown): value is LatLng {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { lat, lng } = value as Record<string, unknown>;
  return typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng);
}

function isFavourite(value: unknown): value is Favourite {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.address === "string" &&
    isLatLng(candidate.location) &&
    (candidate.resolvedAddress === undefined || typeof candidate.resolvedAddress === "string")
  );
}

/**
 * Read the saved favourites from localStorage. Returns an empty list when
 * storage is unavailable or the stored value is missing or malformed.
 */
export function loadFavourites(): Favourite[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isFavourite);
  } catch {
    return [];
  }
}

/** Persist the favourites to localStorage, ignoring storage failures. */
export function persistFavourites(list: Favourite[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage failures (private mode, blocked cookies, quota). The list
    // still works for the current session.
  }
}
