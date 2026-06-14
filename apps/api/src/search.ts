import {
  DEFAULT_MEAL_MINUTES,
  type LatLng,
  type MealFit,
  type Origin,
  type ResultLeg,
  type ResultVenue,
  SEARCH_DEFAULTS,
  type SearchRequestBody,
  type SearchResponseBody,
  type WeekTime,
  bayesianRating,
  evaluateMealFit,
  haversineMeters,
  mealServiceForCategory,
  normalizeWeights,
  parseTimeOfDay,
  resolveMealTarget,
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
  /**
   * Minimum distance between two returned venues, in metres. A light spacing
   * rule drops near-duplicate venues clustered on the same street so the list
   * shows geographic variety. Set to 0 to disable spacing.
   */
  minVenueSeparationMeters: number;
  /** Configuration for the travel-time area finding stage. */
  area: AreaFinderConfig;
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  // Prune the pooled venues to this many before the (more expensive) venue
  // travel matrix. With up to 4 areas at 60 venues each, the pooled, deduped
  // set comfortably exceeds the ~100 venue target, so a higher prune limit lets
  // more of that pool reach the scorer. The transit matrix chunks by the 100
  // element cap, so 36 destinations stays within one or two requests for typical
  // group sizes (see the routes element cap in packages/providers).
  candidateLimit: 36,
  defaultLimit: SEARCH_DEFAULTS.limit,
  // Text Search (New) caps pagination at 3 pages of 20, so 3 pages yields the
  // maximum 60 venues per area from a single query without silently failing.
  searchPages: 3,
  areaRadiusMeters: 1_300,
  // Roughly a short city block. Big enough to break up several venues on one
  // street, small enough to keep genuinely distinct nearby venues.
  minVenueSeparationMeters: 250,
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
 *
 * To stop one dense area from swamping the pool, each place is assigned to its
 * nearest meeting area and the candidates are drawn round-robin across those
 * areas, best first within each. That guarantees every area contributes a fair
 * share, so a cluster of venues around a single hub cannot crowd out the
 * variety offered by the other areas.
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

  const nearestCenter: number[] = [];
  const distances = places.map((place, index) => {
    let best = Infinity;
    let bestIndex = 0;
    centers.forEach((center, ci) => {
      const distance = haversineMeters(center, place.location);
      if (distance < best) {
        best = distance;
        bestIndex = ci;
      }
    });
    nearestCenter[index] = bestIndex;
    return best;
  });
  const ratings = places.map((place) => bayesianRating(place.rating, place.ratingCount));
  const maxDistance = Math.max(...distances, 1);
  const minRating = Math.min(...ratings);
  const maxRating = Math.max(...ratings);
  const ratingSpan = maxRating - minRating;

  // Bucket the pool by nearest area, ranked best first within each bucket.
  const buckets = new Map<number, Array<{ place: Place; preScore: number }>>();
  places.forEach((place, index) => {
    const proximity = 1 - distances[index]! / maxDistance;
    const ratingScore = ratingSpan > 0 ? (ratings[index]! - minRating) / ratingSpan : 0.5;
    const entry = { place, preScore: 0.5 * proximity + 0.5 * ratingScore };
    const bucket = buckets.get(nearestCenter[index]!);
    if (bucket) {
      bucket.push(entry);
    } else {
      buckets.set(nearestCenter[index]!, [entry]);
    }
  });
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => b.preScore - a.preScore);
  }

  // Order the areas by their strongest candidate, then draw round-robin so the
  // pool is shared fairly across areas rather than dominated by one cluster.
  const orderedBuckets = [...buckets.values()].sort((a, b) => b[0]!.preScore - a[0]!.preScore);
  const selected: Place[] = [];
  for (let round = 0; selected.length < limit; round += 1) {
    let tookOne = false;
    for (const bucket of orderedBuckets) {
      const entry = bucket[round];
      if (!entry) {
        continue;
      }
      selected.push(entry.place);
      tookOne = true;
      if (selected.length >= limit) {
        break;
      }
    }
    if (!tookOne) {
      break;
    }
  }
  return selected;
}

/**
 * Pick up to `limit` items best first while keeping them geographically spread,
 * so the results are not several near-identical venues on a single street.
 *
 * Greedy: walk the already-ranked list best first and accept an item only when
 * it is at least `minSeparationMeters` from every item already accepted. Items
 * that are too close are held back and used only to backfill if spacing alone
 * cannot fill the limit. That breaks up clustering without ever returning fewer
 * results or giving up a slot purely for spacing, so a clearly better venue is
 * never dropped when no varied alternative exists.
 */
export function spaceOutByLocation<T>(
  ranked: T[],
  getLocation: (item: T) => LatLng,
  limit: number,
  minSeparationMeters: number,
): T[] {
  if (limit <= 0) {
    return [];
  }
  if (minSeparationMeters <= 0) {
    return ranked.slice(0, limit);
  }
  const selected: T[] = [];
  const deferred: T[] = [];
  for (const item of ranked) {
    if (selected.length >= limit) {
      break;
    }
    const location = getLocation(item);
    const farEnough = selected.every(
      (kept) => haversineMeters(getLocation(kept), location) >= minSeparationMeters,
    );
    if (farEnough) {
      selected.push(item);
    } else {
      deferred.push(item);
    }
  }
  if (selected.length < limit) {
    selected.push(...deferred.slice(0, limit - selected.length));
  }
  return selected;
}

/**
 * Build the meal fit evaluator for a search, or null when the category is not
 * meal specific (cafe, pub). The target time defaults to a typical hour for the
 * meal and can be overridden by the caller's meet time.
 */
export function mealFitEvaluator(
  body: SearchRequestBody,
  now: Date = new Date(),
): ((place: Place) => MealFit) | null {
  const meal = mealServiceForCategory(body.category);
  if (!meal) {
    return null;
  }
  const minutes = parseTimeOfDay(body.meetTime) ?? DEFAULT_MEAL_MINUTES[meal];
  const target: WeekTime = resolveMealTarget(minutes, now);
  return (place: Place) => {
    const serves = meal === "lunch" ? place.servesLunch : place.servesDinner;
    return evaluateMealFit({ serves, hours: place.regularOpeningHours, target });
  };
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
            priceLevels: body.priceLevels,
            minRating: body.minRating,
            cuisines: body.cuisines,
          }),
        ),
      ),
    { areas: centers.length, radiusMeters: searchRadiusMeters },
  );
  const found = dedupePlacesById(pools.flat());

  // For lunch and dinner, judge each venue against the meet time so the search
  // favours places open and serving then. Venues we know are shut are dropped,
  // unless that would empty the pool, in which case we keep everything.
  const mealFit = mealFitEvaluator(body);
  let pool = found;
  if (mealFit) {
    const open = found.filter((place) => !mealFit(place).closed);
    pool = open.length > 0 ? open : found;
  }

  const candidates = preselectCandidates(centers, pool, config.candidateLimit);
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

  // Nudge reachable venues that do not serve the meal down the ranking, while
  // keeping unreachable venues last so the meal penalty cannot leapfrog them.
  const ranked = mealFit
    ? scored
        .map((entry) => {
          if (!entry.reachable) {
            return entry;
          }
          const place = placeById.get(entry.id);
          const penalty = place ? mealFit(place).penalty : 0;
          return { ...entry, finalScore: entry.finalScore + penalty };
        })
        .sort((a, b) => a.finalScore - b.finalScore)
    : scored;

  // Apply a light spacing rule so the returned list shows geographic variety
  // rather than several near-identical venues clustered on one street.
  const spaced = spaceOutByLocation(
    ranked,
    (entry) => placeById.get(entry.id)?.location ?? primaryCenter,
    limit,
    config.minVenueSeparationMeters,
  );

  const venues: ResultVenue[] = spaced.flatMap((entry) => {
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
        servesLunch: place.servesLunch,
        servesDinner: place.servesDinner,
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
