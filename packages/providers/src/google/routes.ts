import type { LatLng } from "@meetup/core";
import type { TravelProvider } from "../interfaces";
import type { TravelMatrixCell, TravelMatrixRequest, TravelMatrixResult } from "../types";
import {
  type GoogleProviderOptions,
  parseDurationSeconds,
  readError,
  resolveFetch,
  travelModeToGoogle,
} from "./shared";

const ROUTE_MATRIX_URL =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

const MATRIX_FIELD_MASK =
  "originIndex,destinationIndex,duration,distanceMeters,condition,status";

// Routes API element caps: 100 for transit, 625 otherwise.
const MAX_ELEMENTS_TRANSIT = 100;
const MAX_ELEMENTS_DEFAULT = 625;

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

    const cells: TravelMatrixCell[] = [];
    for (let start = 0; start < destinationCount; start += destinationsPerRequest) {
      const chunk = request.destinations.slice(start, start + destinationsPerRequest);
      const body = this.buildBody(request.origins, chunk, travelMode, request.departureTime);

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
      cells.push(...parseMatrixElements(elements, start));
    }

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
    return body;
  }
}
