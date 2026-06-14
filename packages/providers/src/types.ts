import type { LatLng, RegularOpeningHours, TravelMode, VenueCategory } from "@meetup/core";

/** A function with the same shape as the global fetch. Injected for testing. */
export type FetchLike = typeof fetch;

/** A venue returned by a places provider. */
export interface Place {
  id: string;
  name: string;
  location: LatLng;
  rating?: number;
  ratingCount?: number;
  /** 0 (free) to 4 (very expensive) when known. */
  priceLevel?: number;
  address?: string;
  /** Human readable primary category, e.g. "Coffee shop". */
  categoryLabel?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  openNow?: boolean;
  /** Whether the venue serves breakfast, when known. */
  servesBreakfast?: boolean;
  /** Whether the venue serves lunch, when known. */
  servesLunch?: boolean;
  /** Whether the venue serves dinner, when known. */
  servesDinner?: boolean;
  /** Weekly opening hours, used to judge whether a venue is open at meet time. */
  regularOpeningHours?: RegularOpeningHours;
  /** Provider photo reference, used to lazily fetch an image. */
  photoRef?: string;
}

export interface PlacesSearchRequest {
  center: LatLng;
  radiusMeters: number;
  category: VenueCategory;
  /** How many pages of 20 results to fetch (1 to 3). Defaults to 3. */
  maxPages?: number;
  openNow?: boolean;
}

export interface TravelMatrixRequest {
  origins: LatLng[];
  destinations: LatLng[];
  mode: TravelMode;
  /** Departure time for transit and traffic aware results. Defaults to now. */
  departureTime?: Date;
}

export interface TravelMatrixCell {
  originIndex: number;
  destinationIndex: number;
  /** Travel time in seconds, or null when no route exists. */
  durationSeconds: number | null;
  distanceMeters: number | null;
}

export interface TravelMatrixResult {
  origins: number;
  destinations: number;
  cells: TravelMatrixCell[];
}

export interface GeocodeResult {
  location: LatLng;
  formattedAddress: string;
}
