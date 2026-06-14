import type {
  TransitPreferences,
  TransitRoutingPreference,
  TransitTravelMode,
  TravelMode,
  VenueCategory,
} from "@meetup/core";
import type { FetchLike } from "../types";

export interface GoogleProviderOptions {
  apiKey: string;
  /** Inject a custom fetch for testing. Defaults to the global fetch. */
  fetchImpl?: FetchLike;
}

export function resolveFetch(options: GoogleProviderOptions): FetchLike {
  const impl = options.fetchImpl ?? globalThis.fetch;
  if (!impl) {
    throw new Error("No fetch implementation available");
  }
  return impl;
}

/** Map a user facing category onto a Text Search query string. */
export function categoryToTextQuery(category: VenueCategory): string {
  switch (category) {
    case "cafe":
      return "cafe";
    case "lunch":
      return "lunch restaurant";
    case "dinner":
      return "dinner restaurant";
    case "pub":
      return "pub";
    case "park":
      return "park";
    default: {
      const exhaustive: never = category;
      throw new Error(`Unknown category: ${String(exhaustive)}`);
    }
  }
}

/**
 * Build the Text Search query for a category, optionally biased by cuisine or
 * keyword hints. Multiple cuisines are joined with "or" so the search returns a
 * mix (e.g. "indian or thai dinner restaurant"). Blank hints are ignored.
 */
export function buildTextQuery(category: VenueCategory, cuisines?: string[]): string {
  const base = categoryToTextQuery(category);
  const cleaned = (cuisines ?? []).map((cuisine) => cuisine.trim()).filter((cuisine) => cuisine);
  if (cleaned.length === 0) {
    return base;
  }
  return `${cleaned.join(" or ")} ${base}`;
}

const CAFE_PRIMARY_TYPES = new Set(["cafe", "coffee_shop", "tea_house"]);
const PUB_PRIMARY_TYPES = new Set(["bar", "pub", "wine_bar", "bar_and_grill"]);
const PARK_PRIMARY_TYPES = new Set([
  "park",
  "national_park",
  "state_park",
  "garden",
  "botanical_garden",
  "dog_park",
  "picnic_ground",
  "plaza",
]);

/**
 * Decide whether a place belongs to the chosen category based on its primary
 * type. Filtering on the primary type (rather than any of a place's types) is
 * what keeps hotels and cinemas that merely contain a bar out of a pub search.
 */
export function matchesCategoryPrimaryType(
  category: VenueCategory,
  primaryType: string | undefined,
): boolean {
  if (!primaryType) {
    return false;
  }
  switch (category) {
    case "cafe":
      return CAFE_PRIMARY_TYPES.has(primaryType);
    case "lunch":
    case "dinner":
      return primaryType === "restaurant" || primaryType.endsWith("_restaurant");
    case "pub":
      return PUB_PRIMARY_TYPES.has(primaryType);
    case "park":
      return PARK_PRIMARY_TYPES.has(primaryType);
    default: {
      const exhaustive: never = category;
      throw new Error(`Unknown category: ${String(exhaustive)}`);
    }
  }
}

/** Map our travel mode onto a Routes API travel mode. */
export function travelModeToGoogle(mode: TravelMode): "TRANSIT" | "WALK" | "DRIVE" {
  switch (mode) {
    case "transit":
      return "TRANSIT";
    case "walking":
      return "WALK";
    case "driving":
      return "DRIVE";
    case "cycling":
      throw new Error(
        "Cycling is not supported by the Routes route matrix; use transit, walking, or driving",
      );
    default: {
      const exhaustive: never = mode;
      throw new Error(`Unknown travel mode: ${String(exhaustive)}`);
    }
  }
}

const TRANSIT_MODE_TO_GOOGLE: Record<TransitTravelMode, string> = {
  bus: "BUS",
  subway: "SUBWAY",
  train: "TRAIN",
  light_rail: "LIGHT_RAIL",
  rail: "RAIL",
};

const TRANSIT_ROUTING_TO_GOOGLE: Record<TransitRoutingPreference, string> = {
  less_walking: "LESS_WALKING",
  fewer_transfers: "FEWER_TRANSFERS",
};

/**
 * Map our transit preferences onto a Routes API `transitPreferences` object.
 * Returns undefined when there is nothing meaningful to send, so callers can
 * omit the field entirely.
 */
export function transitPreferencesToGoogle(
  preferences: TransitPreferences | undefined,
): Record<string, unknown> | undefined {
  if (!preferences) {
    return undefined;
  }
  const result: Record<string, unknown> = {};
  const allowed = preferences.allowedModes
    ?.filter((mode): mode is TransitTravelMode => mode in TRANSIT_MODE_TO_GOOGLE)
    .map((mode) => TRANSIT_MODE_TO_GOOGLE[mode]);
  if (allowed && allowed.length > 0) {
    result.allowedTravelModes = allowed;
  }
  if (preferences.routingPreference) {
    result.routingPreference = TRANSIT_ROUTING_TO_GOOGLE[preferences.routingPreference];
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Parse a protobuf style duration string such as "1234s" or "1234.5s"
 * into whole seconds. Returns null when the value is missing or invalid.
 */
export function parseDurationSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const match = /^([0-9]+(?:\.[0-9]+)?)s$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return Math.round(Number(match[1]));
}

export async function readError(response: Response): Promise<string> {
  let detail = "";
  try {
    detail = await response.text();
  } catch {
    detail = "";
  }
  return `Google API request failed (${response.status} ${response.statusText}): ${detail}`;
}
