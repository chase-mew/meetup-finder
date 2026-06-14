import {
  type Objective,
  type Origin,
  type SearchRequestBody,
  type TransitPreferences,
  type TransitRoutingPreference,
  type TransitTravelMode,
  type TravelMode,
  type VenueCategory,
  parseTimeOfDay,
} from "@meetup/core";

export type ValidationResult =
  | { ok: true; value: SearchRequestBody }
  | { ok: false; error: string };

const CATEGORIES: VenueCategory[] = ["cafe", "lunch", "dinner", "pub", "park"];
// Cycling is intentionally excluded: the Routes matrix endpoint cannot do it.
const MODES: TravelMode[] = ["transit", "walking", "driving"];
const OBJECTIVES: Objective[] = ["best", "min_total", "min_max", "min_variance"];
const TRANSIT_MODES: TransitTravelMode[] = ["bus", "subway", "train", "light_rail", "rail"];
const TRANSIT_ROUTING: TransitRoutingPreference[] = ["less_walking", "fewer_transfers"];

const MAX_ORIGINS = 10;
const MAX_CUISINES = 8;
const MAX_CUISINE_LENGTH = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidLat(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLng(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

function parseOrigins(raw: unknown): Origin[] | string {
  if (!Array.isArray(raw)) {
    return "origins must be an array";
  }
  if (raw.length < 2) {
    return "at least two origins are required";
  }
  if (raw.length > MAX_ORIGINS) {
    return `a maximum of ${MAX_ORIGINS} origins is supported`;
  }

  const origins: Origin[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!isRecord(item)) {
      return `origin ${i} must be an object`;
    }
    const location = item.location;
    if (!isRecord(location) || !isValidLat(location.lat) || !isValidLng(location.lng)) {
      return `origin ${i} needs a valid location { lat, lng }`;
    }
    const weight = item.weight;
    if (weight !== undefined && (typeof weight !== "number" || !(weight > 0))) {
      return `origin ${i} weight must be a positive number`;
    }
    origins.push({
      id: typeof item.id === "string" && item.id ? item.id : `origin-${i}`,
      label: typeof item.label === "string" ? item.label : undefined,
      location: { lat: location.lat, lng: location.lng },
      weight: typeof weight === "number" ? weight : undefined,
    });
  }
  return origins;
}

function parseWeight(value: unknown, field: string): number | string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    return `${field} must be a number between 0 and 1`;
  }
  return value;
}

function parseTransitPreferences(raw: unknown): TransitPreferences | string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    return "transit must be an object";
  }

  const preferences: TransitPreferences = {};

  if (raw.allowedModes !== undefined) {
    if (!Array.isArray(raw.allowedModes)) {
      return "transit.allowedModes must be an array";
    }
    const allowedModes: TransitTravelMode[] = [];
    for (const mode of raw.allowedModes) {
      if (typeof mode !== "string" || !TRANSIT_MODES.includes(mode as TransitTravelMode)) {
        return `transit.allowedModes must contain only: ${TRANSIT_MODES.join(", ")}`;
      }
      if (!allowedModes.includes(mode as TransitTravelMode)) {
        allowedModes.push(mode as TransitTravelMode);
      }
    }
    if (allowedModes.length > 0) {
      preferences.allowedModes = allowedModes;
    }
  }

  if (raw.routingPreference !== undefined) {
    if (
      typeof raw.routingPreference !== "string" ||
      !TRANSIT_ROUTING.includes(raw.routingPreference as TransitRoutingPreference)
    ) {
      return `transit.routingPreference must be one of: ${TRANSIT_ROUTING.join(", ")}`;
    }
    preferences.routingPreference = raw.routingPreference as TransitRoutingPreference;
  }

  return Object.keys(preferences).length > 0 ? preferences : undefined;
}

function parsePriceLevels(raw: unknown): number[] | string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return "priceLevels must be an array";
  }
  const levels: number[] = [];
  for (const item of raw) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 1 || item > 4) {
      return "priceLevels must contain integers between 1 and 4";
    }
    if (!levels.includes(item)) {
      levels.push(item);
    }
  }
  return levels.length > 0 ? levels : undefined;
}

function parseMinRating(raw: unknown): number | string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 5) {
    return "minRating must be a number between 0 and 5";
  }
  return raw;
}

function parseCuisines(raw: unknown): string[] | string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return "cuisines must be an array";
  }
  if (raw.length > MAX_CUISINES) {
    return `a maximum of ${MAX_CUISINES} cuisines is supported`;
  }
  const cuisines: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      return "each cuisine must be a string";
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed.length > MAX_CUISINE_LENGTH) {
      return `cuisine names must be ${MAX_CUISINE_LENGTH} characters or fewer`;
    }
    if (!cuisines.includes(trimmed)) {
      cuisines.push(trimmed);
    }
  }
  return cuisines.length > 0 ? cuisines : undefined;
}

/** Validate and normalise an untrusted request body. */
export function validateSearchRequest(input: unknown): ValidationResult {
  if (!isRecord(input)) {
    return { ok: false, error: "request body must be a JSON object" };
  }

  const origins = parseOrigins(input.origins);
  if (typeof origins === "string") {
    return { ok: false, error: origins };
  }

  const category = input.category;
  if (typeof category !== "string" || !CATEGORIES.includes(category as VenueCategory)) {
    return { ok: false, error: `category must be one of: ${CATEGORIES.join(", ")}` };
  }

  const mode = input.mode ?? "transit";
  if (typeof mode !== "string" || !MODES.includes(mode as TravelMode)) {
    return { ok: false, error: `mode must be one of: ${MODES.join(", ")}` };
  }

  let objective: Objective | undefined;
  if (input.objective !== undefined) {
    if (typeof input.objective !== "string" || !OBJECTIVES.includes(input.objective as Objective)) {
      return { ok: false, error: `objective must be one of: ${OBJECTIVES.join(", ")}` };
    }
    objective = input.objective as Objective;
  }

  const travelWeight = parseWeight(input.travelWeight, "travelWeight");
  if (typeof travelWeight === "string") {
    return { ok: false, error: travelWeight };
  }
  const ratingWeight = parseWeight(input.ratingWeight, "ratingWeight");
  if (typeof ratingWeight === "string") {
    return { ok: false, error: ratingWeight };
  }

  let limit: number | undefined;
  if (input.limit !== undefined) {
    if (typeof input.limit !== "number" || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10) {
      return { ok: false, error: "limit must be an integer between 1 and 10" };
    }
    limit = input.limit;
  }

  let searchRadiusMeters: number | undefined;
  if (input.searchRadiusMeters !== undefined) {
    if (
      typeof input.searchRadiusMeters !== "number" ||
      !Number.isFinite(input.searchRadiusMeters) ||
      input.searchRadiusMeters < 200 ||
      input.searchRadiusMeters > 20_000
    ) {
      return { ok: false, error: "searchRadiusMeters must be between 200 and 20000" };
    }
    searchRadiusMeters = input.searchRadiusMeters;
  }

  const openNow = input.openNow === undefined ? undefined : input.openNow === true;

  let meetTime: string | undefined;
  if (input.meetTime !== undefined) {
    if (typeof input.meetTime !== "string" || parseTimeOfDay(input.meetTime) === undefined) {
      return { ok: false, error: 'meetTime must be a 24 hour time like "12:30"' };
    }
    meetTime = input.meetTime.trim();
  }

  const transit = parseTransitPreferences(input.transit);
  if (typeof transit === "string") {
    return { ok: false, error: transit };
  }

  const priceLevels = parsePriceLevels(input.priceLevels);
  if (typeof priceLevels === "string") {
    return { ok: false, error: priceLevels };
  }

  const minRating = parseMinRating(input.minRating);
  if (typeof minRating === "string") {
    return { ok: false, error: minRating };
  }

  const cuisines = parseCuisines(input.cuisines);
  if (typeof cuisines === "string") {
    return { ok: false, error: cuisines };
  }

  return {
    ok: true,
    value: {
      origins,
      category: category as VenueCategory,
      mode: mode as TravelMode,
      objective,
      travelWeight,
      ratingWeight,
      limit,
      openNow,
      searchRadiusMeters,
      meetTime,
      transit,
      priceLevels,
      minRating,
      cuisines,
    },
  };
}
