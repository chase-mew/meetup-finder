import {
  type LatLng,
  type Origin,
  type ResultLeg,
  type ResultVenue,
  SEARCH_DEFAULTS,
  type SearchRequestBody,
  type SearchResponseBody,
  bayesianRating,
  haversineMeters,
  normalizeWeights,
  scoreVenues,
  weightedGeometricMedian,
} from "@meetup/core";
import type { Place, PlacesProvider, TravelProvider } from "@meetup/providers";
import { type AreaFinderConfig, DEFAULT_AREA_CONFIG, findMeetingAreas } from "./areas";
import { type Logger, createLogger, timed } from "./logger";

export interface SearchDeps {
  places: PlacesProvider;
  travel: TravelProvider;
  /** Structured logger for stage timing and errors. Defaults to a silent one. */
  logger?: Logger;
}

export interface SearchConfig {
  /** How many venues to keep before the venue travel matrix. Controls cost. */
  candidateLimit: number;
  /** How many results to return. */
  defaultLimit: number;
  /** How many pages of places (20 each) to gather per area before pruning. */
  searchPages: number;
  /** Venue search radius around each chosen meeting area, in metres. */
  areaRadiusMeters: number;
  /** Configuration for the travel-time area finding stage. */
  area: AreaFinderConfig;
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  candidateLimit: 24,
  defaultLimit: SEARCH_DEFAULTS.limit,
  searchPages: 2,
  areaRadiusMeters: 1_300,
  area: DEFAULT_AREA_CONFIG,
};

/** Derive a venue search radius from how spread out the group is. */
export function deriveSearchRadius(
  seed: { lat: number; lng: number },
  origins: Origin[],
): number {
  let maxDistance = 0;
  for (const origin of origins) {
    maxDistance = Math.max(maxDistance, haversineMeters(seed, origin.location));
  }
  const radius = maxDistance * 0.35;
  return Math.min(6_000, Math.max(1_200, Math.round(radius)));
}

/**
 * Choose which venues to send to the (more expensive) travel matrix.
 *
 * Rather than picking the geographically nearest, which ignores quality, we
 * rank the gathered pool by a blend of proximity to the meeting point and a
 * Bayesian rating, so the scorer receives the most promising candidates. This
 * is a cheap pre-filter; the final ranking still uses real travel times.
 */
export function preselectCandidates(
  centers: LatLng[],
  places: Place[],
  limit: number,
): Place[] {
  // With no centre there is no proximity signal; just cap to the limit.
  if (centers.length === 0) {
    return places.slice(0, Math.max(0, limit));
  }
  if (places.length <= limit) {
    return places;
  }

  const distances = places.map((place) =>
    Math.min(...centers.map((center) => haversineMeters(center, place.location))),
  );
  const ratings = places.map((place) => bayesianRating(place.rating, place.ratingCount));
  const maxDistance = Math.max(...distances, 1);
  const minRating = Math.min(...ratings);
  const maxRating = Math.max(...ratings);
  const ratingSpan = maxRating - minRating;

  return places
    .map((place, index) => {
      const proximity = 1 - distances[index]! / maxDistance;
      const ratingScore = ratingSpan > 0 ? (ratings[index]! - minRating) / ratingSpan : 0.5;
      return { place, preScore: 0.5 * proximity + 0.5 * ratingScore };
    })
    .sort((a, b) => b.preScore - a.preScore)
    .slice(0, limit)
    .map((entry) => entry.place);
}

/** Remove duplicate venues that appear in more than one area's search. */
export function dedupePlacesById(places: Place[]): Place[] {
  const seen = new Set<string>();
  const unique: Place[] = [];
  for (const place of places) {
    if (!seen.has(place.id)) {
      seen.add(place.id);
      unique.push(place);
    }
  }
  return unique;
}

/**
 * Run the full meeting point search pipeline:
 * seed, venue search, prune, travel matrix, score, assemble.
 */
export async function runSearch(
  deps: SearchDeps,
  body: SearchRequestBody,
  config: SearchConfig = DEFAULT_SEARCH_CONFIG,
): Promise<SearchResponseBody> {
  const logger = deps.logger ?? createLogger({}, { sink: () => {} });
  const origins = body.origins;
  if (origins.length === 0) {
    throw new Error("At least one origin is required");
  }

  const objective = body.objective ?? SEARCH_DEFAULTS.objective;
  const median = weightedGeometricMedian(
    origins.map((o) => o.location),
    origins.map((o) => o.weight ?? 1),
  );

  // Stage one: find the best meeting areas by real travel time, not geometry.
  const areas = await timed(logger, "areas", () =>
    findMeetingAreas(deps.travel, origins, body.mode, objective, config.area, body.transit),
  );
  const centers: LatLng[] = areas.length > 0 ? areas.map((a) => a.center) : [median];
  const primaryCenter = centers[0]!;

  const searchRadiusMeters = body.searchRadiusMeters ?? config.areaRadiusMeters;

  // Stage two: gather venues around each chosen area (in parallel) and dedupe.
  const pools = await timed(
    logger,
    "places",
    () =>
      Promise.all(
        centers.map((center) =>
          deps.places.search({
            center,
            radiusMeters: searchRadiusMeters,
            category: body.category,
            maxPages: config.searchPages,
            openNow: body.openNow,
          }),
        ),
      ),
    { areas: centers.length, radiusMeters: searchRadiusMeters },
  );
  const found = dedupePlacesById(pools.flat());

  const candidates = preselectCandidates(centers, found, config.candidateLimit);
  logger.info("candidates selected", { found: found.length, candidates: candidates.length });

  const weights = normalizeWeights({
    travel: body.travelWeight ?? SEARCH_DEFAULTS.travelWeight,
    rating: body.ratingWeight ?? SEARCH_DEFAULTS.ratingWeight,
  });

  if (candidates.length === 0) {
    logger.warn("no venues found near meeting areas", { radiusMeters: searchRadiusMeters });
    return {
      seed: primaryCenter,
      origins,
      category: body.category,
      mode: body.mode,
      objective,
      weights,
      searchRadiusMeters,
      venues: [],
      unreachableOrigins: [],
    };
  }

  const matrix = await timed(
    logger,
    "travel",
    () =>
      deps.travel.matrix({
        origins: origins.map((o) => o.location),
        destinations: candidates.map((c) => c.location),
        mode: body.mode,
        transit: body.transit,
      }),
    { origins: origins.length, destinations: candidates.length },
  );

  const durationGrid: Array<Array<number | null>> = origins.map(() =>
    candidates.map(() => null),
  );
  const distanceGrid: Array<Array<number | null>> = origins.map(() =>
    candidates.map(() => null),
  );
  for (const cell of matrix.cells) {
    if (
      cell.originIndex >= 0 &&
      cell.originIndex < origins.length &&
      cell.destinationIndex >= 0 &&
      cell.destinationIndex < candidates.length
    ) {
      durationGrid[cell.originIndex]![cell.destinationIndex] = cell.durationSeconds;
      distanceGrid[cell.originIndex]![cell.destinationIndex] = cell.distanceMeters;
    }
  }

  const scored = scoreVenues(
    candidates.map((candidate, destinationIndex) => ({
      id: candidate.id,
      rating: candidate.rating,
      ratingCount: candidate.ratingCount,
      durationsSeconds: origins.map(
        (_, originIndex) => durationGrid[originIndex]![destinationIndex]!,
      ),
    })),
    {
      objective,
      weights,
    },
  );

  const placeById = new Map<string, Place>(candidates.map((c) => [c.id, c]));
  const indexById = new Map<string, number>(candidates.map((c, i) => [c.id, i]));
  const limit = body.limit ?? config.defaultLimit;

  const venues: ResultVenue[] = scored.slice(0, limit).flatMap((entry) => {
    const place = placeById.get(entry.id);
    const destinationIndex = indexById.get(entry.id);
    if (!place || destinationIndex === undefined) {
      return [];
    }
    const legs: ResultLeg[] = origins.map((origin, originIndex) => ({
      originId: origin.id,
      originLabel: origin.label,
      durationSeconds: durationGrid[originIndex]![destinationIndex]!,
      distanceMeters: distanceGrid[originIndex]![destinationIndex]!,
    }));

    return [
      {
        id: place.id,
        name: place.name,
        location: place.location,
        rating: place.rating,
        ratingCount: place.ratingCount,
        priceLevel: place.priceLevel,
        address: place.address,
        categoryLabel: place.categoryLabel,
        googleMapsUri: place.googleMapsUri,
        websiteUri: place.websiteUri,
        openNow: place.openNow,
        photoRef: place.photoRef,
        reachable: entry.reachable,
        finalScore: entry.finalScore,
        bayesianRating: entry.bayesianRating,
        objectiveCostSeconds: entry.objectiveCostSeconds,
        totalSeconds: entry.totalSeconds,
        maxSeconds: entry.maxSeconds,
        normalizedTravel: entry.normalizedTravel,
        normalizedRating: entry.normalizedRating,
        legs,
      } satisfies ResultVenue,
    ];
  });

  // An origin is "stuck" when no returned venue is reachable from it. Surfacing
  // this lets the client name who is unreachable instead of only flagging venues.
  const unreachableOrigins = origins
    .filter((origin) =>
      venues.every((venue) =>
        venue.legs.some((leg) => leg.originId === origin.id && leg.durationSeconds === null),
      ),
    )
    .map((origin) => origin.id);

  if (unreachableOrigins.length > 0) {
    logger.warn("origins unreachable for all returned venues", {
      unreachableOrigins,
      venues: venues.length,
    });
  }

  return {
    seed: primaryCenter,
    origins,
    category: body.category,
    mode: body.mode,
    objective,
    weights,
    searchRadiusMeters,
    venues,
    unreachableOrigins,
  };
}
