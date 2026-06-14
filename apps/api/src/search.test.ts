import { haversineMeters, type SearchRequestBody } from "@meetup/core";
import type { Place, PlacesProvider, TravelMatrixRequest, TravelProvider } from "@meetup/providers";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SEARCH_CONFIG, deriveSearchRadius, runSearch } from "./search";

const ORIGINS: SearchRequestBody["origins"] = [
  { id: "a", label: "Alice", location: { lat: 51.5308, lng: -0.1238 } }, // King's Cross
  { id: "b", label: "Bob", location: { lat: 51.5036, lng: -0.1144 } }, // Waterloo
];

function makePlace(id: string, lat: number, lng: number, rating: number, count: number): Place {
  return { id, name: id, location: { lat, lng }, rating, ratingCount: count };
}

const FOUND_PLACES: Place[] = [
  makePlace("central", 51.5165, -0.119, 4.5, 800),
  makePlace("north", 51.525, -0.12, 4.6, 900),
  makePlace("south", 51.508, -0.115, 4.4, 700),
  makePlace("east", 51.515, -0.1, 4.7, 1000),
  makePlace("west", 51.515, -0.14, 4.3, 600),
  makePlace("faraway", 51.6, -0.05, 4.9, 5000),
];

function fakePlaces(places: Place[] = FOUND_PLACES): PlacesProvider {
  return { search: vi.fn(async () => places) };
}

// Travel time proportional to straight line distance, so results are deterministic.
function fakeTravel(): TravelProvider {
  return {
    matrix: vi.fn(async (req: TravelMatrixRequest) => {
      const cells = [];
      for (let oi = 0; oi < req.origins.length; oi += 1) {
        for (let di = 0; di < req.destinations.length; di += 1) {
          const meters = haversineMeters(req.origins[oi]!, req.destinations[di]!);
          cells.push({
            originIndex: oi,
            destinationIndex: di,
            durationSeconds: Math.round(meters / 5),
            distanceMeters: Math.round(meters),
          });
        }
      }
      return { origins: req.origins.length, destinations: req.destinations.length, cells };
    }),
  };
}

const baseBody: SearchRequestBody = {
  origins: ORIGINS,
  category: "cafe",
  mode: "transit",
};

describe("deriveSearchRadius", () => {
  it("stays within sensible bounds", () => {
    const radius = deriveSearchRadius({ lat: 51.51, lng: -0.12 }, ORIGINS);
    expect(radius).toBeGreaterThanOrEqual(1_200);
    expect(radius).toBeLessThanOrEqual(6_000);
  });
});

describe("runSearch", () => {
  it("computes a seed, scores venues, and returns legs per origin", async () => {
    const places = fakePlaces();
    const travel = fakeTravel();
    const result = await runSearch({ places, travel }, baseBody);

    expect(result.seed.lat).toBeGreaterThan(51.5);
    expect(result.venues.length).toBeGreaterThan(0);
    expect(result.objective).toBe("best");

    const top = result.venues[0]!;
    expect(top.legs).toHaveLength(ORIGINS.length);
    expect(top.legs.map((l) => l.originId).sort()).toEqual(["a", "b"]);
    expect(top.reachable).toBe(true);
  });

  it("prunes candidates before the travel matrix to control cost", async () => {
    const places = fakePlaces();
    const travel = fakeTravel();
    await runSearch({ places, travel }, baseBody, {
      ...DEFAULT_SEARCH_CONFIG,
      candidateLimit: 3,
    });

    const matrixCall = (travel.matrix as ReturnType<typeof vi.fn>).mock.calls[0]![0] as TravelMatrixRequest;
    expect(matrixCall.destinations.length).toBe(3);
  });

  it("respects the result limit", async () => {
    const result = await runSearch({ places: fakePlaces(), travel: fakeTravel() }, {
      ...baseBody,
      limit: 2,
    });
    expect(result.venues.length).toBeLessThanOrEqual(2);
  });

  it("ranks the more central venue above a far but highly rated one under min_max", async () => {
    const result = await runSearch({ places: fakePlaces(), travel: fakeTravel() }, {
      ...baseBody,
      objective: "min_max",
      travelWeight: 0.8,
      ratingWeight: 0.2,
      limit: 6,
    });
    const ids = result.venues.map((v) => v.id);
    expect(ids).toContain("central");
    expect(ids).toContain("faraway");
    expect(ids.indexOf("central")).toBeLessThan(ids.indexOf("faraway"));
  });

  it("returns no venues when the places provider finds nothing", async () => {
    const result = await runSearch({ places: fakePlaces([]), travel: fakeTravel() }, baseBody);
    expect(result.venues).toEqual([]);
  });
});
