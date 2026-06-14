import { describe, expect, it, vi } from "vitest";
import { GoogleGeocodingProvider, parseGeocodeResponse } from "./geocoding";

describe("parseGeocodeResponse", () => {
  it("returns the first result location", () => {
    const result = parseGeocodeResponse({
      status: "OK",
      results: [
        {
          formatted_address: "King's Cross, London, UK",
          geometry: { location: { lat: 51.5308, lng: -0.1238 } },
        },
      ],
    });
    expect(result).toEqual({
      location: { lat: 51.5308, lng: -0.1238 },
      formattedAddress: "King's Cross, London, UK",
    });
  });

  it("returns null when there are no results", () => {
    expect(parseGeocodeResponse({ status: "ZERO_RESULTS", results: [] })).toBeNull();
  });
});

describe("GoogleGeocodingProvider", () => {
  it("calls the geocode endpoint with the address and key", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: "OK",
          results: [
            { formatted_address: "X", geometry: { location: { lat: 1, lng: 2 } } },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new GoogleGeocodingProvider({ apiKey: "k", fetchImpl });
    const result = await provider.geocode("Waterloo Station");

    expect(result?.location).toEqual({ lat: 1, lng: 2 });
    const calledUrl = String(fetchImpl.mock.calls[0]![0]);
    expect(calledUrl).toContain("address=Waterloo+Station");
    expect(calledUrl).toContain("key=k");
  });

  it("returns null for an empty query without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const provider = new GoogleGeocodingProvider({ apiKey: "k", fetchImpl });
    expect(await provider.geocode("   ")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reverse geocodes coordinates into an address", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: "OK",
          results: [
            {
              formatted_address: "King's Cross, London, UK",
              geometry: { location: { lat: 51.5308, lng: -0.1238 } },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new GoogleGeocodingProvider({ apiKey: "k", fetchImpl });
    const result = await provider.reverseGeocode({ lat: 51.5308, lng: -0.1238 });

    expect(result?.formattedAddress).toBe("King's Cross, London, UK");
    const calledUrl = String(fetchImpl.mock.calls[0]![0]);
    expect(calledUrl).toContain("latlng=51.5308%2C-0.1238");
    expect(calledUrl).toContain("key=k");
  });

  it("returns null for out of range coordinates without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const provider = new GoogleGeocodingProvider({ apiKey: "k", fetchImpl });
    expect(await provider.reverseGeocode({ lat: 200, lng: 0 })).toBeNull();
    expect(await provider.reverseGeocode({ lat: Number.NaN, lng: 0 })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
