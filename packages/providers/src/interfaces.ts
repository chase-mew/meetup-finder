import type { LatLng } from "@meetup/core";
import type {
  AutocompletePrediction,
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

/** Suggests addresses as a user types and resolves a chosen one to coordinates. */
export interface AutocompleteProvider {
  autocomplete(query: string, sessionToken?: string): Promise<AutocompletePrediction[]>;
  resolve(placeId: string, sessionToken?: string): Promise<GeocodeResult | null>;
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
