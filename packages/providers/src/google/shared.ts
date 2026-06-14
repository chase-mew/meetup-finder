import type { TravelMode, VenueCategory } from "@meetup/core";
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

/** Map a user facing category onto Places API (New) included types. */
export function categoryToIncludedTypes(category: VenueCategory): string[] {
  switch (category) {
    case "cafe":
      return ["cafe", "coffee_shop"];
    case "lunch":
      return ["restaurant"];
    case "dinner":
      return ["restaurant"];
    case "pub":
      return ["pub", "bar"];
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
