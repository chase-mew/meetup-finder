import { describe, expect, it, vi } from "vitest";
import { GooglePlacesProvider, boundingRectangle, parsePlace } from "./places";

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
      primaryType: "coffee_shop",
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

describe("boundingRectangle", () => {
  it("produces a box around the centre", () => {
    const rect = boundingRectangle({ lat: 51.5, lng: -0.12 }, 1500);
    expect(rect.low.latitude).toBeLessThan(51.5);
    expect(rect.high.latitude).toBeGreaterThan(51.5);
    expect(rect.low.longitude).toBeLessThan(-0.12);
    expect(rect.high.longitude).toBeGreaterThan(-0.12);
  });
});

describe("GooglePlacesProvider", () => {
  it("filters results to the category primary type and keeps real pubs only", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          places: [
            { id: "pub1", location: { latitude: 51.5, longitude: -0.1 }, primaryType: "pub" },
            { id: "bar1", location: { latitude: 51.5, longitude: -0.1 }, primaryType: "bar" },
            { id: "hotel1", location: { latitude: 51.5, longitude: -0.1 }, primaryType: "lodging" },
            { id: "cinema1", location: { latitude: 51.5, longitude: -0.1 }, primaryType: "movie_theater" },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new GooglePlacesProvider({ apiKey: "k", fetchImpl });
    const places = await provider.search({
      center: { lat: 51.5, lng: -0.1 },
      radiusMeters: 1500,
      category: "pub",
      maxPages: 1,
    });

    expect(places.map((p) => p.id)).toEqual(["pub1", "bar1"]);
    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-Goog-FieldMask"]).toContain("nextPageToken");
    expect(headers["X-Goog-FieldMask"]).toContain("places.primaryType");
    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent.textQuery).toBe("pub");
    expect(sent.locationRestriction.rectangle).toBeDefined();
  });

  it("paginates while a nextPageToken is returned and dedupes", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      if (!body.pageToken) {
        return new Response(
          JSON.stringify({
            places: [
              { id: "a", location: { latitude: 51.5, longitude: -0.1 }, primaryType: "cafe" },
            ],
            nextPageToken: "token-2",
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          places: [
            { id: "a", location: { latitude: 51.5, longitude: -0.1 }, primaryType: "cafe" },
            { id: "b", location: { latitude: 51.51, longitude: -0.1 }, primaryType: "coffee_shop" },
          ],
        }),
        { status: 200 },
      );
    });
    const provider = new GooglePlacesProvider({ apiKey: "k", fetchImpl });
    const places = await provider.search({
      center: { lat: 51.5, lng: -0.1 },
      radiusMeters: 1500,
      category: "cafe",
      maxPages: 3,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(places.map((p) => p.id).sort()).toEqual(["a", "b"]);
  });

  it("defaults to the maximum pages when maxPages is missing or invalid", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          places: [{ id: "x", location: { latitude: 51.5, longitude: -0.1 }, primaryType: "cafe" }],
          nextPageToken: "always-more",
        }),
        { status: 200 },
      ),
    );
    const provider = new GooglePlacesProvider({ apiKey: "k", fetchImpl });
    await provider.search({
      center: { lat: 51.5, lng: -0.1 },
      radiusMeters: 1500,
      category: "cafe",
      maxPages: Number.NaN,
    });
    // NaN must not collapse to zero fetches; it falls back to the page cap of 3.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("stops at the requested page limit", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          places: [{ id: "x", location: { latitude: 51.5, longitude: -0.1 }, primaryType: "cafe" }],
          nextPageToken: "always-more",
        }),
        { status: 200 },
      ),
    );
    const provider = new GooglePlacesProvider({ apiKey: "k", fetchImpl });
    await provider.search({
      center: { lat: 51.5, lng: -0.1 },
      radiusMeters: 1500,
      category: "cafe",
      maxPages: 2,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
