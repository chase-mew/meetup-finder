import { describe, expect, it, vi } from "vitest";
import { GooglePlacesProvider, parsePlace, parseSearchResponse } from "./places";

describe("parsePlace", () => {
  it("maps the response fields", () => {
    const place = parsePlace({
      id: "abc",
      displayName: { text: "Flat White" },
      location: { latitude: 51.51, longitude: -0.13 },
      rating: 4.6,
      userRatingCount: 1200,
      priceLevel: "PRICE_LEVEL_MODERATE",
      formattedAddress: "Soho, London",
      primaryTypeDisplayName: { text: "Coffee shop" },
      currentOpeningHours: { openNow: true },
      photos: [{ name: "places/abc/photos/xyz" }],
    });
    expect(place).toMatchObject({
      id: "abc",
      name: "Flat White",
      rating: 4.6,
      ratingCount: 1200,
      priceLevel: 2,
      openNow: true,
      photoRef: "places/abc/photos/xyz",
    });
  });

  it("returns null without an id or location", () => {
    expect(parsePlace({ displayName: { text: "x" } })).toBeNull();
    expect(parsePlace({ id: "x" })).toBeNull();
  });
});

describe("parseSearchResponse", () => {
  const body = {
    places: [
      { id: "open", location: { latitude: 1, longitude: 1 }, currentOpeningHours: { openNow: true } },
      { id: "closed", location: { latitude: 2, longitude: 2 }, currentOpeningHours: { openNow: false } },
      { id: "unknown", location: { latitude: 3, longitude: 3 } },
    ],
  };

  it("keeps everything when openNow filtering is off", () => {
    expect(parseSearchResponse(body, false)).toHaveLength(3);
  });

  it("drops places known to be closed when filtering", () => {
    const ids = parseSearchResponse(body, true).map((p) => p.id);
    expect(ids).toEqual(["open", "unknown"]);
  });
});

describe("GooglePlacesProvider", () => {
  it("posts a nearby search with the field mask and included types", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          places: [{ id: "p1", location: { latitude: 51.5, longitude: -0.1 } }],
        }),
        { status: 200 },
      ),
    );
    const provider = new GooglePlacesProvider({ apiKey: "k", fetchImpl });
    const places = await provider.search({
      center: { lat: 51.5, lng: -0.1 },
      radiusMeters: 1500,
      category: "cafe",
      maxResults: 20,
    });

    expect(places).toHaveLength(1);
    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-Goog-FieldMask"]).toContain("places.rating");
    expect(headers["X-Goog-Api-Key"]).toBe("k");
    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent.includedTypes).toContain("cafe");
    expect(sent.locationRestriction.circle.radius).toBe(1500);
  });
});
