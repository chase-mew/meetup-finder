import {
  type Objective,
  type Origin,
  type ResultLeg,
  type ResultVenue,
  type SearchRequestBody,
  type SearchResponseBody,
  haversineMeters,
  scoreVenues,
  selectNearest,
  weightedGeometricMedian,
} from "@meetup/core";
import type { Place, PlacesProvider, TravelProvider } from "@meetup/providers";

export interface SearchDeps {
  places: PlacesProvider;
  travel: TravelProvider;
}

export interface SearchConfig {
  /** How many venues to keep before the travel matrix. Controls cost. */
  candidateLimit: number;
  /** How many results to return. */
  defaultLimit: number;
  /** How many venues to request from the places provider. */
  searchResultCount: number;
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  candidateLimit: 8,
  defaultLimit: 5,
  searchResultCount: 20,
};

const DEFAULT_OBJECTIVE: Objective = "min_max";
const DEFAULT_TRAVEL_WEIGHT = 0.7;
const DEFAULT_RATING_WEIGHT = 0.3;

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
 * Run the full meeting point search pipeline:
 * seed, venue search, prune, travel matrix, score, assemble.
 */
export async function runSearch(
  deps: SearchDeps,
  body: SearchRequestBody,
  config: SearchConfig = DEFAULT_SEARCH_CONFIG,
): Promise<SearchResponseBody> {
  const origins = body.origins;
  if (origins.length === 0) {
    throw new Error("At least one origin is required");
  }

  const seed = weightedGeometricMedian(
    origins.map((o) => o.location),
    origins.map((o) => o.weight ?? 1),
  );

  const searchRadiusMeters =
    body.searchRadiusMeters ?? deriveSearchRadius(seed, origins);

  const found = await deps.places.search({
    center: seed,
    radiusMeters: searchRadiusMeters,
    category: body.category,
    maxResults: config.searchResultCount,
    openNow: body.openNow,
  });

  const candidates = selectNearest(
    seed,
    found,
    config.candidateLimit,
    (place) => place.location,
  );

  const objective = body.objective ?? DEFAULT_OBJECTIVE;

  if (candidates.length === 0) {
    return {
      seed,
      origins,
      category: body.category,
      mode: body.mode,
      objective,
      searchRadiusMeters,
      venues: [],
    };
  }

  const matrix = await deps.travel.matrix({
    origins: origins.map((o) => o.location),
    destinations: candidates.map((c) => c.location),
    mode: body.mode,
  });

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
      weights: {
        travel: body.travelWeight ?? DEFAULT_TRAVEL_WEIGHT,
        rating: body.ratingWeight ?? DEFAULT_RATING_WEIGHT,
      },
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
        legs,
      } satisfies ResultVenue,
    ];
  });

  return {
    seed,
    origins,
    category: body.category,
    mode: body.mode,
    objective,
    searchRadiusMeters,
    venues,
  };
}
