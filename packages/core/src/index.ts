export type {
  LatLng,
  TravelMode,
  VenueCategory,
  TransitTravelMode,
  TransitRoutingPreference,
  TransitPreferences,
  Objective,
  BaseObjective,
  Origin,
  ScoreWeights,
  RatingPrior,
  ScoreOptions,
  ScoringCandidate,
  ScoredCandidate,
} from "./types";

export {
  haversineMeters,
  centroid,
  weightedGeometricMedian,
  selectNearest,
} from "./geo";
export type { GeometricMedianOptions } from "./geo";

export {
  totalSeconds,
  maxSeconds,
  meanSeconds,
  varianceSeconds,
  objectiveCost,
} from "./objectives";

export {
  DEFAULT_RATING_PRIOR,
  bayesianRating,
  normalizeRating,
} from "./rating";

export { scoreVenues, normalizeWeights } from "./scoring";

export { SEARCH_DEFAULTS } from "./defaults";

export {
  DEFAULT_MEAL_MINUTES,
  SERVE_PENALTY,
  CLOSED_PENALTY,
  mealServiceForCategory,
  parseTimeOfDay,
  resolveMealTarget,
  isOpenAt,
  evaluateMealFit,
} from "./hours";
export type {
  OpeningHoursPoint,
  OpeningPeriod,
  RegularOpeningHours,
  WeekTime,
  MealService,
  MealFit,
  MealFitInput,
} from "./hours";

export type {
  SearchRequestBody,
  SearchResponseBody,
  ResultLeg,
  ResultVenue,
} from "./api";

export {
  noopReporter,
  parseDsn,
  SentryReporter,
  createReporter,
} from "./reporting";
export type {
  ReportLevel,
  ReportContext,
  ErrorReporter,
  ParsedDsn,
  SentryReporterOptions,
  CreateReporterOptions,
} from "./reporting";
