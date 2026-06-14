/** A geographic point. */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Supported travel modes. The MVP focuses on transit. */
export type TravelMode = "transit" | "walking" | "cycling" | "driving";

/** High level venue category chosen by the user. */
export type VenueCategory = "cafe" | "lunch" | "dinner" | "pub" | "park";

/** Public transit submodes that a transit route may use. */
export type TransitTravelMode = "bus" | "subway" | "train" | "light_rail" | "rail";

/** How a transit route should be optimised when several options exist. */
export type TransitRoutingPreference = "less_walking" | "fewer_transfers";

/** Optional preferences shaping how transit routes are computed. */
export interface TransitPreferences {
  /**
   * Submodes the route is allowed to use. When omitted or empty, all submodes
   * are allowed. Only applied when the travel mode is transit.
   */
  allowedModes?: TransitTravelMode[];
  /** Prefer fewer transfers or less walking. */
  routingPreference?: TransitRoutingPreference;
}

/**
 * Travel cost objective used to score how good a venue is for the group.
 * - min_total: minimise the sum of travel times (most efficient overall).
 * - min_max: minimise the worst single travel time (fairest).
 * - min_variance: make travel times as even as possible across people.
 * - best: balance all three by blending their normalised costs, weighting the
 *   two fairness measures above raw efficiency so the result lands between
 *   people rather than next to one of them (the default). See
 *   BEST_OBJECTIVE_WEIGHTS.
 */
export type Objective = "min_total" | "min_max" | "min_variance" | "best";

/** The concrete objectives that can be computed directly from durations. */
export type BaseObjective = Exclude<Objective, "best">;

/** A person starting point. */
export interface Origin {
  id: string;
  label?: string;
  location: LatLng;
  /** Relative importance of this person. Defaults to 1. */
  weight?: number;
}

/** Weights applied when blending travel cost and venue rating. */
export interface ScoreWeights {
  /** How much travel time matters. Defaults to 0.7. */
  travel: number;
  /** How much venue rating matters. Defaults to 0.3. */
  rating: number;
}

/** Bayesian prior used to damp ratings that have few reviews. */
export interface RatingPrior {
  /** Assumed mean rating for a place with no reviews. */
  mean: number;
  /** Strength of the prior, expressed as a number of pseudo reviews. */
  weight: number;
}

/** Options controlling how venues are scored and ranked. */
export interface ScoreOptions {
  objective: Objective;
  weights?: ScoreWeights;
  ratingPrior?: RatingPrior;
  /** Minimum and maximum possible rating, used to normalise. Defaults to 1 and 5. */
  ratingRange?: { min: number; max: number };
}

/** A venue plus the per person travel durations to reach it. */
export interface ScoringCandidate {
  id: string;
  rating?: number;
  ratingCount?: number;
  /**
   * Travel time in seconds from each origin to this venue.
   * Order must align with the origins array passed to the scorer.
   * Use null for an origin that cannot reach this venue.
   */
  durationsSeconds: Array<number | null>;
}

/** The result of scoring a single candidate venue. */
export interface ScoredCandidate {
  id: string;
  /** Whether every origin can reach this venue. */
  reachable: boolean;
  /** Raw value of the chosen objective, in seconds. */
  objectiveCostSeconds: number;
  totalSeconds: number;
  maxSeconds: number;
  /** Population variance of the durations, in seconds squared. */
  varianceSeconds: number;
  /** Travel cost normalised across the candidate set, 0 best, 1 worst. */
  normalizedTravel: number;
  /** Rating after the Bayesian prior is applied. */
  bayesianRating: number;
  /** Rating normalised to 0..1, 1 best. */
  normalizedRating: number;
  /** Final blended score. Lower is better. */
  finalScore: number;
}
