import type { AutocompleteProvider } from "../interfaces";
import type { AutocompletePrediction, GeocodeResult } from "../types";
import { type GoogleProviderOptions, readError, resolveFetch } from "./shared";

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const PLACE_DETAILS_BASE = "https://places.googleapis.com/v1/places";
const DETAILS_FIELD_MASK = "location,formattedAddress,displayName";

interface AutocompleteApiResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
}

interface PlaceDetailsApiResponse {
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
  displayName?: { text?: string };
}

export function parseAutocompleteResponse(
  body: AutocompleteApiResponse,
): AutocompletePrediction[] {
  const predictions: AutocompletePrediction[] = [];
  for (const suggestion of body.suggestions ?? []) {
    const prediction = suggestion.placePrediction;
    const placeId = prediction?.placeId;
    if (!placeId) {
      continue;
    }
    const mainText = prediction?.structuredFormat?.mainText?.text;
    const secondaryText = prediction?.structuredFormat?.secondaryText?.text;
    const description =
      prediction?.text?.text ??
      [mainText, secondaryText].filter(Boolean).join(", ");
    if (!description) {
      continue;
    }
    predictions.push({ placeId, description, mainText, secondaryText });
  }
  return predictions;
}

export function parsePlaceDetailsResponse(body: PlaceDetailsApiResponse): GeocodeResult | null {
  const lat = body.location?.latitude;
  const lng = body.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return null;
  }
  return {
    location: { lat, lng },
    formattedAddress: body.formattedAddress ?? body.displayName?.text ?? "",
  };
}

export class GoogleAutocompleteProvider implements AutocompleteProvider {
  private readonly options: GoogleProviderOptions;

  constructor(options: GoogleProviderOptions) {
    this.options = options;
  }

  async autocomplete(query: string, sessionToken?: string): Promise<AutocompletePrediction[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    const fetchImpl = resolveFetch(this.options);
    const body: Record<string, unknown> = {
      input: trimmed,
      languageCode: "en",
      // Restrict to the United Kingdom for the MVP.
      includedRegionCodes: ["gb"],
    };
    if (sessionToken) {
      body.sessionToken = sessionToken;
    }

    const response = await fetchImpl(AUTOCOMPLETE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.options.apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const data = (await response.json()) as AutocompleteApiResponse;
    return parseAutocompleteResponse(data);
  }

  async resolve(placeId: string, sessionToken?: string): Promise<GeocodeResult | null> {
    const trimmed = placeId.trim();
    if (!trimmed) {
      return null;
    }
    const fetchImpl = resolveFetch(this.options);
    const url = new URL(`${PLACE_DETAILS_BASE}/${encodeURIComponent(trimmed)}`);
    if (sessionToken) {
      url.searchParams.set("sessionToken", sessionToken);
    }

    const response = await fetchImpl(url.toString(), {
      headers: {
        "X-Goog-Api-Key": this.options.apiKey,
        "X-Goog-FieldMask": DETAILS_FIELD_MASK,
      },
    });
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const data = (await response.json()) as PlaceDetailsApiResponse;
    return parsePlaceDetailsResponse(data);
  }
}
