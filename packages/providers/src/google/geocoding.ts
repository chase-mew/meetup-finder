import type { LatLng } from "@meetup/core";
import type { GeocodingProvider } from "../interfaces";
import type { GeocodeResult } from "../types";
import { type GoogleProviderOptions, readError, resolveFetch } from "./shared";

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

interface GeocodeApiResponse {
  status: string;
  results?: Array<{
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
  }>;
}

export function parseGeocodeResponse(body: GeocodeApiResponse): GeocodeResult | null {
  if (body.status !== "OK" || !body.results || body.results.length === 0) {
    return null;
  }
  const first = body.results[0]!;
  const loc = first.geometry?.location;
  if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
    return null;
  }
  return {
    location: { lat: loc.lat, lng: loc.lng },
    formattedAddress: first.formatted_address ?? "",
  };
}

export class GoogleGeocodingProvider implements GeocodingProvider {
  private readonly options: GoogleProviderOptions;

  constructor(options: GoogleProviderOptions) {
    this.options = options;
  }

  async geocode(query: string): Promise<GeocodeResult | null> {
    const trimmed = query.trim();
    if (!trimmed) {
      return null;
    }
    const fetchImpl = resolveFetch(this.options);
    const url = new URL(GEOCODE_URL);
    url.searchParams.set("address", trimmed);
    url.searchParams.set("key", this.options.apiKey);
    // Bias results toward the United Kingdom for the MVP.
    url.searchParams.set("region", "gb");

    const response = await fetchImpl(url.toString());
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const body = (await response.json()) as GeocodeApiResponse;
    return parseGeocodeResponse(body);
  }

  async reverseGeocode(location: LatLng): Promise<GeocodeResult | null> {
    if (
      !Number.isFinite(location.lat) ||
      !Number.isFinite(location.lng) ||
      Math.abs(location.lat) > 90 ||
      Math.abs(location.lng) > 180
    ) {
      return null;
    }
    const fetchImpl = resolveFetch(this.options);
    const url = new URL(GEOCODE_URL);
    url.searchParams.set("latlng", `${location.lat},${location.lng}`);
    url.searchParams.set("key", this.options.apiKey);

    const response = await fetchImpl(url.toString());
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const body = (await response.json()) as GeocodeApiResponse;
    return parseGeocodeResponse(body);
  }
}
