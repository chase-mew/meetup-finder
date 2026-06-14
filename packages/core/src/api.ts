import type {
  LatLng,
  Objective,
  Origin,
  ScoreWeights,
  TransitPreferences,
  TravelMode,
  VenueCategory,
} from "./types";

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
  /** Optional transit preferences, applied only when mode is transit. */
  transit?: TransitPreferences;
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
  photoRef?: string;
  reachable: boolean;
  finalScore: number;
  bayesianRating: number;
  objectiveCostSeconds: number;
  totalSeconds: number;
  maxSeconds: number;
  /** Travel cost normalised across the results, 0 best, 1 worst. */
  normalizedTravel: number;
  /** Rating normalised to 0..1, 1 best. */
  normalizedRating: number;
  legs: ResultLeg[];
}

/** Body of a successful POST /api/search response. */
export interface SearchResponseBody {
  seed: LatLng;
  origins: Origin[];
  category: VenueCategory;
  mode: TravelMode;
  objective: Objective;
  /** Normalised travel and rating weights actually used to rank, summing to 1. */
  weights: ScoreWeights;
  /** Radius used for the venue search, in metres. */
  searchRadiusMeters: number;
  venues: ResultVenue[];
  /**
   * Ids of origins that no returned venue can reach by the chosen mode. Lets
   * the client call out exactly who is stuck rather than only flagging venues.
   * Empty when everyone can reach at least one venue.
   */
  unreachableOrigins: string[];
}
