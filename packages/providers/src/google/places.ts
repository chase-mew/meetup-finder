import type { PlacesProvider } from "../interfaces";
import type { Place, PlacesSearchRequest } from "../types";
import {
  type GoogleProviderOptions,
  categoryToIncludedTypes,
  readError,
  resolveFetch,
} from "./shared";

const SEARCH_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";

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
  "places.primaryTypeDisplayName",
  "places.photos",
].join(",");

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
  primaryTypeDisplayName?: { text?: string };
  photos?: Array<{ name?: string }>;
}

interface SearchNearbyResponse {
  places?: PlacesApiPlace[];
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

export function parseSearchResponse(
  body: SearchNearbyResponse,
  openNowOnly: boolean,
): Place[] {
  const places = (body.places ?? [])
    .map(parsePlace)
    .filter((p): p is Place => p !== null);
  if (!openNowOnly) {
    return places;
  }
  return places.filter((p) => p.openNow !== false);
}

export class GooglePlacesProvider implements PlacesProvider {
  private readonly options: GoogleProviderOptions;

  constructor(options: GoogleProviderOptions) {
    this.options = options;
  }

  async search(request: PlacesSearchRequest): Promise<Place[]> {
    const fetchImpl = resolveFetch(this.options);
    const maxResults = Math.min(Math.max(request.maxResults ?? 20, 1), 20);

    const requestBody = {
      includedTypes: categoryToIncludedTypes(request.category),
      maxResultCount: maxResults,
      rankPreference: "POPULARITY",
      locationRestriction: {
        circle: {
          center: {
            latitude: request.center.lat,
            longitude: request.center.lng,
          },
          radius: request.radiusMeters,
        },
      },
    };

    const response = await fetchImpl(SEARCH_NEARBY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.options.apiKey,
        "X-Goog-FieldMask": SEARCH_FIELD_MASK,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const body = (await response.json()) as SearchNearbyResponse;
    return parseSearchResponse(body, request.openNow === true);
  }
}
