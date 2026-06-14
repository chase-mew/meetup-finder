import { describe, expect, it, vi } from "vitest";
import {
  GoogleAutocompleteProvider,
  parseAutocompleteResponse,
  parsePlaceDetailsResponse,
} from "./autocomplete";

describe("parseAutocompleteResponse", () => {
  it("maps place predictions with structured text", () => {
    const predictions = parseAutocompleteResponse({
      suggestions: [
        {
          placePrediction: {
            placeId: "abc",
            text: { text: "Waterloo Station, London, UK" },
            structuredFormat: {
              mainText: { text: "Waterloo Station" },
              secondaryText: { text: "London, UK" },
            },
          },
        },
      ],
    });
    expect(predictions).toEqual([
      {
        placeId: "abc",
        description: "Waterloo Station, London, UK",
        mainText: "Waterloo Station",
        secondaryText: "London, UK",
      },
    ]);
  });

  it("falls back to structured text when full text is missing", () => {
    const predictions = parseAutocompleteResponse({
      suggestions: [
        {
          placePrediction: {
            placeId: "xyz",
            structuredFormat: {
              mainText: { text: "King's Cross" },
              secondaryText: { text: "London" },
            },
          },
        },
      ],
    });
    expect(predictions[0]?.description).toBe("King's Cross, London");
  });

  it("skips suggestions without a place id and query predictions", () => {
    const predictions = parseAutocompleteResponse({
      suggestions: [
        { placePrediction: { text: { text: "No id here" } } },
        {},
      ],
    });
    expect(predictions).toEqual([]);
  });

  it("returns an empty list when there are no suggestions", () => {
    expect(parseAutocompleteResponse({})).toEqual([]);
  });
});

describe("parsePlaceDetailsResponse", () => {
  it("reads coordinates and formatted address", () => {
    expect(
      parsePlaceDetailsResponse({
        location: { latitude: 51.5, longitude: -0.12 },
        formattedAddress: "Somewhere, London",
      }),
    ).toEqual({
      location: { lat: 51.5, lng: -0.12 },
      formattedAddress: "Somewhere, London",
    });
  });

  it("falls back to the display name when no formatted address exists", () => {
    expect(
      parsePlaceDetailsResponse({
        location: { latitude: 1, longitude: 2 },
        displayName: { text: "The Place" },
      }),
    ).toEqual({ location: { lat: 1, lng: 2 }, formattedAddress: "The Place" });
  });

  it("returns null without a location", () => {
    expect(parsePlaceDetailsResponse({ formattedAddress: "x" })).toBeNull();
  });
});

describe("GoogleAutocompleteProvider", () => {
  it("posts the query with a UK region restriction and api key", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          suggestions: [
            { placePrediction: { placeId: "p1", text: { text: "A place" } } },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new GoogleAutocompleteProvider({ apiKey: "k", fetchImpl });
    const result = await provider.autocomplete("water", "session-1");

    expect(result).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("places:autocomplete");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("k");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      input: "water",
      includedRegionCodes: ["gb"],
      sessionToken: "session-1",
    });
  });

  it("returns an empty list for a blank query without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const provider = new GoogleAutocompleteProvider({ apiKey: "k", fetchImpl });
    expect(await provider.autocomplete("   ")).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resolves a place id to coordinates with a field mask", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          location: { latitude: 51.5, longitude: -0.12 },
          formattedAddress: "Resolved, London",
        }),
        { status: 200 },
      ),
    );
    const provider = new GoogleAutocompleteProvider({ apiKey: "k", fetchImpl });
    const result = await provider.resolve("place-123", "session-1");

    expect(result?.location).toEqual({ lat: 51.5, lng: -0.12 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("/places/place-123");
    expect(String(url)).toContain("sessionToken=session-1");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-Goog-FieldMask"]).toContain("location");
  });

  it("returns null when resolving a blank place id", async () => {
    const fetchImpl = vi.fn();
    const provider = new GoogleAutocompleteProvider({ apiKey: "k", fetchImpl });
    expect(await provider.resolve("  ")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
