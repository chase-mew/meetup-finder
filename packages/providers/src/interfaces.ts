import type { LatLng } from "@meetup/core";
import type {
  GeocodeResult,
  Place,
  PlacesSearchRequest,
  TravelMatrixRequest,
  TravelMatrixResult,
} from "./types";

/** Turns a free text address into coordinates, and coordinates back into an address. */
export interface GeocodingProvider {
  geocode(query: string): Promise<GeocodeResult | null>;
  /** Turns coordinates into a readable address. */
  reverseGeocode?(location: LatLng): Promise<GeocodeResult | null>;
}

/** Finds venues near a point and, optionally, enriches a single venue. */
export interface PlacesProvider {
  search(request: PlacesSearchRequest): Promise<Place[]>;
  getDetails?(placeId: string): Promise<Place | null>;
}

/** Computes a matrix of travel times from origins to destinations. */
export interface TravelProvider {
  matrix(request: TravelMatrixRequest): Promise<TravelMatrixResult>;
}
