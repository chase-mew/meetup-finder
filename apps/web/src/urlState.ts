import type { LatLng, Objective, TravelMode, VenueCategory } from "@meetup/core";

/** A single origin as stored in the URL: a label plus rounded coordinates. */
export interface UrlOrigin {
  label: string;
  location: LatLng;
}

/** The full search state that can be reproduced from a shared link. */
export interface SearchUrlState {
  origins: UrlOrigin[];
  category: VenueCategory;
  mode: TravelMode;
  objective: Objective;
  ratingWeight: number;
  limit: number;
  openNow: boolean;
}

const CATEGORIES: readonly VenueCategory[] = ["cafe", "lunch", "dinner", "pub"];
const MODES: readonly TravelMode[] = ["transit", "walking", "cycling", "driving"];
const OBJECTIVES: readonly Objective[] = ["min_total", "min_max", "min_variance", "best"];

const DEFAULTS = {
  category: "cafe" as VenueCategory,
  mode: "transit" as TravelMode,
  objective: "best" as Objective,
  ratingWeight: 0.3,
  limit: 5,
  openNow: false,
};

/** Coordinates are rounded to keep links short while staying accurate enough. */
const COORD_DECIMALS = 5;

/** Upper bound for the result limit, matching the API validation (1..10). */
const MAX_LIMIT = 10;

export function roundCoord(value: number): number {
  return Number(value.toFixed(COORD_DECIMALS));
}

/** Serialise a search state into a compact, readable query string (no leading "?"). */
export function encodeSearchState(state: SearchUrlState): string {
  const params = new URLSearchParams();
  for (const origin of state.origins) {
    const lat = roundCoord(origin.location.lat);
    const lng = roundCoord(origin.location.lng);
    // Label is placed last so commas inside it never break parsing.
    params.append("o", `${lat},${lng},${origin.label}`);
  }
  params.set("cat", state.category);
  params.set("mode", state.mode);
  params.set("obj", state.objective);
  params.set("rw", String(Number(state.ratingWeight.toFixed(2))));
  params.set("limit", String(state.limit));
  params.set("open", state.openNow ? "1" : "0");
  return params.toString();
}

/**
 * Parse a query string back into a search state. Returns null when there are no
 * usable origins, otherwise fills any missing or invalid fields with defaults.
 */
export function decodeSearchState(query: string): SearchUrlState | null {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);

  const origins: UrlOrigin[] = [];
  for (const raw of params.getAll("o")) {
    const origin = parseOrigin(raw);
    if (origin) {
      origins.push(origin);
    }
  }
  if (origins.length === 0) {
    return null;
  }

  return {
    origins,
    category: pickEnum(params.get("cat"), CATEGORIES, DEFAULTS.category),
    mode: pickEnum(params.get("mode"), MODES, DEFAULTS.mode),
    objective: pickEnum(params.get("obj"), OBJECTIVES, DEFAULTS.objective),
    ratingWeight: parseWeight(params.get("rw")),
    limit: parseLimit(params.get("limit")),
    openNow: params.get("open") === "1",
  };
}

/** Build an absolute, shareable URL for the given state. */
export function buildShareUrl(state: SearchUrlState): string {
  const query = encodeSearchState(state);
  if (typeof window === "undefined") {
    return `?${query}`;
  }
  return `${window.location.origin}${window.location.pathname}?${query}`;
}

/** Replace the current URL with one that encodes the given search state. */
export function writeSearchStateToUrl(state: SearchUrlState): void {
  if (typeof window === "undefined") {
    return;
  }
  const query = encodeSearchState(state);
  const url = `${window.location.pathname}?${query}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", url);
}

/** Read and decode the search state from the current URL, if any. */
export function readSearchStateFromUrl(): SearchUrlState | null {
  if (typeof window === "undefined") {
    return null;
  }
  return decodeSearchState(window.location.search);
}

function parseOrigin(raw: string): UrlOrigin | null {
  const firstComma = raw.indexOf(",");
  if (firstComma === -1) {
    return null;
  }
  const secondComma = raw.indexOf(",", firstComma + 1);
  if (secondComma === -1) {
    return null;
  }

  const lat = Number(raw.slice(0, firstComma));
  const lng = Number(raw.slice(firstComma + 1, secondComma));
  const label = raw.slice(secondComma + 1);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  return { label, location: { lat: roundCoord(lat), lng: roundCoord(lng) } };
}

function pickEnum<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function parseWeight(raw: string | null): number {
  if (raw === null) {
    return DEFAULTS.ratingWeight;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return DEFAULTS.ratingWeight;
  }
  return Math.min(1, Math.max(0, value));
}

function parseLimit(raw: string | null): number {
  if (raw === null) {
    return DEFAULTS.limit;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    return DEFAULTS.limit;
  }
  return Math.min(value, MAX_LIMIT);
}
