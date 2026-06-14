import type { LatLng } from "@meetup/core";
import type { TravelProvider } from "../interfaces";
import type { TravelMatrixCell, TravelMatrixRequest, TravelMatrixResult } from "../types";
import {
  type GoogleProviderOptions,
  parseDurationSeconds,
  readError,
  resolveFetch,
  transitPreferencesToGoogle,
  travelModeToGoogle,
} from "./shared";

const ROUTE_MATRIX_URL =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

const MATRIX_FIELD_MASK =
  "originIndex,destinationIndex,duration,distanceMeters,condition,status";

// Routes API element caps: 100 for transit, 625 otherwise.
const MAX_ELEMENTS_TRANSIT = 100;
const MAX_ELEMENTS_DEFAULT = 625;

// How many matrix chunks to send to Google at once. Kept small to reduce
// latency on larger requests without risking rate limits.
const MAX_MATRIX_CONCURRENCY = 4;

interface RouteMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  condition?: string;
  distanceMeters?: number;
  duration?: string;
}

function toWaypoint(point: LatLng) {
  return {
    waypoint: {
      location: { latLng: { latitude: point.lat, longitude: point.lng } },
    },
  };
}

/**
 * Run `worker` over `items`, keeping at most `limit` calls in flight at once.
 * Results are returned in the original item order. The first rejection aborts
 * the remaining work by propagating out of `Promise.all`.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}

export function parseMatrixElements(
  elements: RouteMatrixElement[],
  destinationOffset = 0,
): TravelMatrixCell[] {
  return elements.map((element) => {
    const exists = element.condition === "ROUTE_EXISTS";
    return {
      // proto3 JSON omits zero valued indices, so default to 0.
      originIndex: element.originIndex ?? 0,
      destinationIndex: (element.destinationIndex ?? 0) + destinationOffset,
      durationSeconds: exists ? parseDurationSeconds(element.duration) : null,
      distanceMeters:
        exists && typeof element.distanceMeters === "number"
          ? element.distanceMeters
          : null,
    };
  });
}

export class GoogleTravelProvider implements TravelProvider {
  private readonly options: GoogleProviderOptions;

  constructor(options: GoogleProviderOptions) {
    this.options = options;
  }

  async matrix(request: TravelMatrixRequest): Promise<TravelMatrixResult> {
    const originCount = request.origins.length;
    const destinationCount = request.destinations.length;
    if (originCount === 0 || destinationCount === 0) {
      return { origins: originCount, destinations: destinationCount, cells: [] };
    }

    const fetchImpl = resolveFetch(this.options);
    const travelMode = travelModeToGoogle(request.mode);
    const maxElements =
      travelMode === "TRANSIT" ? MAX_ELEMENTS_TRANSIT : MAX_ELEMENTS_DEFAULT;
    const destinationsPerRequest = Math.max(1, Math.floor(maxElements / originCount));

    // Split the destinations into chunks that respect the element cap, then run
    // those chunks concurrently (bounded) instead of one after another.
    const chunkStarts: number[] = [];
    for (let start = 0; start < destinationCount; start += destinationsPerRequest) {
      chunkStarts.push(start);
    }

    const chunkResults = await mapWithConcurrency(
      chunkStarts,
      MAX_MATRIX_CONCURRENCY,
      async (start) => {
        const chunk = request.destinations.slice(start, start + destinationsPerRequest);
        const body = this.buildBody(
          request.origins,
          chunk,
          travelMode,
          request.departureTime,
          request.transit,
        );

        const response = await fetchImpl(ROUTE_MATRIX_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": this.options.apiKey,
            "X-Goog-FieldMask": MATRIX_FIELD_MASK,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(await readError(response));
        }
        const elements = (await response.json()) as RouteMatrixElement[];
        return parseMatrixElements(elements, start);
      },
    );

    const cells: TravelMatrixCell[] = chunkResults.flat();

    cells.sort(
      (a, b) =>
        a.originIndex - b.originIndex || a.destinationIndex - b.destinationIndex,
    );

    return { origins: originCount, destinations: destinationCount, cells };
  }

  private buildBody(
    origins: LatLng[],
    destinations: LatLng[],
    travelMode: "TRANSIT" | "WALK" | "DRIVE",
    departureTime?: Date,
    transit?: TravelMatrixRequest["transit"],
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      origins: origins.map(toWaypoint),
      destinations: destinations.map(toWaypoint),
      travelMode,
    };
    if (travelMode === "DRIVE") {
      body.routingPreference = "TRAFFIC_AWARE";
    }
    // Only send a departure time when explicitly requested, to avoid
    // "departure time in the past" errors from clock skew.
    if (departureTime && (travelMode === "TRANSIT" || travelMode === "DRIVE")) {
      body.departureTime = departureTime.toISOString();
    }
    // Transit preferences only make sense for transit routes.
    if (travelMode === "TRANSIT") {
      const transitPreferences = transitPreferencesToGoogle(transit);
      if (transitPreferences) {
        body.transitPreferences = transitPreferences;
      }
    }
    return body;
  }
}
