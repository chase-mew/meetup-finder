import type { LatLng, Objective, Origin, TravelMode, VenueCategory } from "./types";

/** Body of a POST /api/search request. */
export interface SearchRequestBody {
  origins: Origin[];
  category: VenueCategory;
  mode: TravelMode;
  /** Defaults to best (balanced across all objectives). See SEARCH_DEFAULTS. */
  objective?: Objective;
  /** How much travel matters, 0..1. Defaults to 0.7. See SEARCH_DEFAULTS. */
  travelWeight?: number;
  /** How much rating matters, 0..1. Defaults to 0.3. See SEARCH_DEFAULTS. */
  ratingWeight?: number;
  /** Number of results to return. Defaults to 8. See SEARCH_DEFAULTS. */
  limit?: number;
  /** Only consider venues currently open. */
  openNow?: boolean;
  /** Optional override for the venue search radius in metres. */
  searchRadiusMeters?: number;
  /**
   * Time of day the group plans to meet, as 24 hour "HH:MM". Used for lunch and
   * dinner searches to favour venues open and serving at that time. Defaults to
   * a typical hour for the chosen meal.
   */
  meetTime?: string;
}

/** Travel detail for one person to one venue. */
export interface ResultLeg {
  originId: string;
  originLabel?: string;
  durationSeconds: number | null;
  distanceMeters: number | null;
}

/** A ranked venue in a search response. */
export interface ResultVenue {
  id: string;
  name: string;
  location: LatLng;
  rating?: number;
  ratingCount?: number;
  priceLevel?: number;
  address?: string;
  categoryLabel?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  openNow?: boolean;
  /** Whether the venue serves lunch, when known. */
  servesLunch?: boolean;
  /** Whether the venue serves dinner, when known. */
  servesDinner?: boolean;
  photoRef?: string;
  reachable: boolean;
  finalScore: number;
  bayesianRating: number;
  objectiveCostSeconds: number;
  totalSeconds: number;
  maxSeconds: number;
  legs: ResultLeg[];
}

/** Body of a successful POST /api/search response. */
export interface SearchResponseBody {
  seed: LatLng;
  origins: Origin[];
  category: VenueCategory;
  mode: TravelMode;
  objective: Objective;
  /** Radius used for the venue search, in metres. */
  searchRadiusMeters: number;
  venues: ResultVenue[];
}
