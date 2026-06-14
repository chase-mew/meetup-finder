import { haversineMeters, type RegularOpeningHours, type SearchRequestBody } from "@meetup/core";
import type { Place, PlacesProvider, TravelMatrixRequest, TravelProvider } from "@meetup/providers";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SEARCH_CONFIG, deriveSearchRadius, mealFitEvaluator, runSearch } from "./search";

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

  it("requests the configured number of pages per area to gather a deeper pool", async () => {
    const places = fakePlaces();
    const travel = fakeTravel();
    await runSearch({ places, travel }, baseBody);

    // 3 pages of 20 is the Text Search cap, the deepest single query pool.
    expect(DEFAULT_SEARCH_CONFIG.searchPages).toBe(3);
    const searchCalls = (places.search as ReturnType<typeof vi.fn>).mock.calls;
    expect(searchCalls.length).toBeGreaterThan(0);
    for (const [request] of searchCalls) {
      expect(request.maxPages).toBe(DEFAULT_SEARCH_CONFIG.searchPages);
    }
  });

  it("prunes the pool to the default candidate limit before the venue matrix", async () => {
    // A pool larger than the limit so we can observe the prune taking effect.
    const pool: Place[] = Array.from({ length: 80 }, (_, i) =>
      makePlace(`v${i}`, 51.5 + i * 0.0005, -0.12 + i * 0.0005, 4.5, 500),
    );
    const places = fakePlaces(pool);
    const travel = fakeTravel();
    await runSearch({ places, travel }, baseBody);

    const calls = (travel.matrix as ReturnType<typeof vi.fn>).mock.calls;
    const venueMatrix = calls.at(-1)![0] as TravelMatrixRequest;
    expect(venueMatrix.destinations.length).toBe(DEFAULT_SEARCH_CONFIG.candidateLimit);
  });

  it("prunes candidates before the venue travel matrix to control cost", async () => {
    const places = fakePlaces();
    const travel = fakeTravel();
    await runSearch({ places, travel }, baseBody, {
      ...DEFAULT_SEARCH_CONFIG,
      candidateLimit: 3,
    });

    // The pipeline runs two matrices: stage one over area anchors, then the
    // venue matrix. The venue matrix (the last call) is the pruned set.
    const calls = (travel.matrix as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const venueMatrix = calls.at(-1)![0] as TravelMatrixRequest;
    expect(venueMatrix.destinations.length).toBe(3);
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
    expect(result.unreachableOrigins).toEqual([]);
  });

  it("flags an origin that cannot reach any returned venue", async () => {
    // Like fakeTravel, but the second origin (index 1) never has a route.
    const travel: TravelProvider = {
      matrix: vi.fn(async (req: TravelMatrixRequest) => {
        const cells = [];
        for (let oi = 0; oi < req.origins.length; oi += 1) {
          for (let di = 0; di < req.destinations.length; di += 1) {
            const reachable = oi !== 1;
            const meters = haversineMeters(req.origins[oi]!, req.destinations[di]!);
            cells.push({
              originIndex: oi,
              destinationIndex: di,
              durationSeconds: reachable ? Math.round(meters / 5) : null,
              distanceMeters: reachable ? Math.round(meters) : null,
            });
          }
        }
        return { origins: req.origins.length, destinations: req.destinations.length, cells };
      }),
    };

    const result = await runSearch({ places: fakePlaces(), travel }, baseBody);
    expect(result.venues.length).toBeGreaterThan(0);
    expect(result.unreachableOrigins).toEqual(["b"]);
  });
});

// Opening hours that repeat the same span every day of the week.
function everyDay(
  open: [number, number],
  close: [number, number],
): RegularOpeningHours {
  return {
    periods: Array.from({ length: 7 }, (_, day) => ({
      open: { day, hour: open[0], minute: open[1] },
      close: { day, hour: close[0], minute: close[1] },
    })),
  };
}

describe("mealFitEvaluator", () => {
  it("is null for non meal categories", () => {
    expect(mealFitEvaluator({ ...baseBody, category: "cafe" })).toBeNull();
    expect(mealFitEvaluator({ ...baseBody, category: "pub" })).toBeNull();
  });

  it("penalises a venue that does not serve the meal", () => {
    const evaluator = mealFitEvaluator({ ...baseBody, category: "dinner" });
    const place = makePlace("x", 51.5, -0.1, 4.5, 100);
    expect(evaluator).not.toBeNull();
    const fit = evaluator!({ ...place, servesDinner: false, regularOpeningHours: everyDay([17, 0], [23, 0]) });
    expect(fit.closed).toBe(false);
    expect(fit.penalty).toBeGreaterThan(0);
  });
});

describe("runSearch meal awareness", () => {
  // Two venues at the same spot so only the meal fit separates them.
  const here = { lat: 51.515, lng: -0.118 };

  it("ranks a venue serving the meal above one that does not", async () => {
    const serving: Place = {
      id: "serves",
      name: "serves",
      location: here,
      rating: 4.5,
      ratingCount: 500,
      servesDinner: true,
      regularOpeningHours: everyDay([17, 0], [23, 30]),
    };
    const notServing: Place = {
      id: "no-serve",
      name: "no-serve",
      location: here,
      rating: 4.5,
      ratingCount: 500,
      servesDinner: false,
      regularOpeningHours: everyDay([17, 0], [23, 30]),
    };
    const result = await runSearch(
      { places: fakePlaces([serving, notServing]), travel: fakeTravel() },
      { ...baseBody, category: "dinner", limit: 5 },
    );
    const ids = result.venues.map((v) => v.id);
    expect(ids).toContain("serves");
    expect(ids).toContain("no-serve");
    expect(ids.indexOf("serves")).toBeLessThan(ids.indexOf("no-serve"));
  });

  it("excludes a venue clearly shut at the dinner meet time", async () => {
    const open: Place = {
      id: "open",
      name: "open",
      location: here,
      rating: 4.4,
      ratingCount: 400,
      servesDinner: true,
      regularOpeningHours: everyDay([17, 0], [23, 0]),
    };
    const shut: Place = {
      id: "shut",
      name: "shut",
      location: here,
      rating: 4.9,
      ratingCount: 5000,
      servesDinner: true,
      regularOpeningHours: everyDay([8, 0], [15, 0]),
    };
    const result = await runSearch(
      { places: fakePlaces([open, shut]), travel: fakeTravel() },
      { ...baseBody, category: "dinner", meetTime: "19:30", limit: 5 },
    );
    const ids = result.venues.map((v) => v.id);
    expect(ids).toContain("open");
    expect(ids).not.toContain("shut");
  });

  it("leaves cafe searches unaffected by opening hours", async () => {
    const result = await runSearch(
      { places: fakePlaces(), travel: fakeTravel() },
      { ...baseBody, category: "cafe" },
    );
    expect(result.venues.length).toBeGreaterThan(0);
  });
});
