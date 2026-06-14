import type { LatLng } from "@meetup/core";
import type { PlacesProvider } from "../interfaces";
import type { Place, PlacesSearchRequest } from "../types";
import {
  type GoogleProviderOptions,
  categoryToTextQuery,
  matchesCategoryPrimaryType,
  readError,
  resolveFetch,
} from "./shared";

const SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";

const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.formattedAddress",
  "places.googleMapsUri",
  "places.websiteUri",
  "places.currentOpeningHours.openNow",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.photos",
  "nextPageToken",
].join(",");

const MAX_PAGES = 3;
const METERS_PER_DEGREE_LAT = 111_320;

interface PlacesApiPlace {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  formattedAddress?: string;
  googleMapsUri?: string;
  websiteUri?: string;
  currentOpeningHours?: { openNow?: boolean };
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  photos?: Array<{ name?: string }>;
}

interface SearchTextResponse {
  places?: PlacesApiPlace[];
  nextPageToken?: string;
}

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

function mapPriceLevel(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  return PRICE_LEVELS[value];
}

export function parsePlace(raw: PlacesApiPlace): Place | null {
  const lat = raw.location?.latitude;
  const lng = raw.location?.longitude;
  if (!raw.id || typeof lat !== "number" || typeof lng !== "number") {
    return null;
  }
  return {
    id: raw.id,
    name: raw.displayName?.text ?? "Unnamed place",
    location: { lat, lng },
    rating: raw.rating,
    ratingCount: raw.userRatingCount,
    priceLevel: mapPriceLevel(raw.priceLevel),
    address: raw.formattedAddress,
    categoryLabel: raw.primaryTypeDisplayName?.text,
    googleMapsUri: raw.googleMapsUri,
    websiteUri: raw.websiteUri,
    openNow: raw.currentOpeningHours?.openNow,
    photoRef: raw.photos?.[0]?.name,
  };
}

/** A latitude/longitude box approximately `radiusMeters` around the centre. */
export function boundingRectangle(center: LatLng, radiusMeters: number) {
  const latDelta = radiusMeters / METERS_PER_DEGREE_LAT;
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  const lngDelta = radiusMeters / (METERS_PER_DEGREE_LAT * Math.max(0.01, Math.abs(cosLat)));
  return {
    low: { latitude: center.lat - latDelta, longitude: center.lng - lngDelta },
    high: { latitude: center.lat + latDelta, longitude: center.lng + lngDelta },
  };
}

export class GooglePlacesProvider implements PlacesProvider {
  private readonly options: GoogleProviderOptions;

  constructor(options: GoogleProviderOptions) {
    this.options = options;
  }

  async search(request: PlacesSearchRequest): Promise<Place[]> {
    const fetchImpl = resolveFetch(this.options);
    const maxPages = Math.min(Math.max(request.maxPages ?? MAX_PAGES, 1), MAX_PAGES);

    const baseBody: Record<string, unknown> = {
      textQuery: categoryToTextQuery(request.category),
      pageSize: 20,
      languageCode: "en",
      regionCode: "GB",
      locationRestriction: {
        rectangle: boundingRectangle(request.center, request.radiusMeters),
      },
    };
    if (request.openNow) {
      baseBody.openNow = true;
    }

    const collected: Place[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;

    for (let page = 0; page < maxPages; page += 1) {
      const body = pageToken ? { ...baseBody, pageToken } : baseBody;
      const response = await fetchImpl(SEARCH_TEXT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.options.apiKey,
          "X-Goog-FieldMask": SEARCH_FIELD_MASK,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }
      const data = (await response.json()) as SearchTextResponse;

      for (const raw of data.places ?? []) {
        if (!matchesCategoryPrimaryType(request.category, raw.primaryType)) {
          continue;
        }
        const place = parsePlace(raw);
        if (place && !seen.has(place.id)) {
          seen.add(place.id);
          collected.push(place);
        }
      }

      pageToken = data.nextPageToken;
      if (!pageToken) {
        break;
      }
    }

    return collected;
  }
}
