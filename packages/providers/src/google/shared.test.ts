import { describe, expect, it } from "vitest";
import {
  categoryToTextQuery,
  matchesCategoryPrimaryType,
  parseDurationSeconds,
  transitPreferencesToGoogle,
  travelModeToGoogle,
} from "./shared";

describe("categoryToTextQuery", () => {
  it("maps each category to a text query", () => {
    expect(categoryToTextQuery("cafe")).toBe("cafe");
    expect(categoryToTextQuery("lunch")).toContain("restaurant");
    expect(categoryToTextQuery("dinner")).toContain("restaurant");
    expect(categoryToTextQuery("pub")).toBe("pub");
    expect(categoryToTextQuery("park")).toBe("park");
  });
});

describe("matchesCategoryPrimaryType", () => {
  it("accepts cafes and coffee shops for the cafe category", () => {
    expect(matchesCategoryPrimaryType("cafe", "cafe")).toBe(true);
    expect(matchesCategoryPrimaryType("cafe", "coffee_shop")).toBe(true);
    expect(matchesCategoryPrimaryType("cafe", "bar")).toBe(false);
  });

  it("accepts restaurants and their subtypes for lunch and dinner", () => {
    expect(matchesCategoryPrimaryType("lunch", "restaurant")).toBe(true);
    expect(matchesCategoryPrimaryType("dinner", "italian_restaurant")).toBe(true);
    expect(matchesCategoryPrimaryType("dinner", "lodging")).toBe(false);
  });

  it("accepts bars and pubs for the pub category", () => {
    expect(matchesCategoryPrimaryType("pub", "pub")).toBe(true);
    expect(matchesCategoryPrimaryType("pub", "bar")).toBe(true);
    expect(matchesCategoryPrimaryType("pub", "wine_bar")).toBe(true);
  });

  it("accepts parks and outdoor spaces for the park category", () => {
    expect(matchesCategoryPrimaryType("park", "park")).toBe(true);
    expect(matchesCategoryPrimaryType("park", "national_park")).toBe(true);
    expect(matchesCategoryPrimaryType("park", "garden")).toBe(true);
    expect(matchesCategoryPrimaryType("park", "dog_park")).toBe(true);
    expect(matchesCategoryPrimaryType("park", "plaza")).toBe(true);
    expect(matchesCategoryPrimaryType("park", "restaurant")).toBe(false);
    expect(matchesCategoryPrimaryType("park", undefined)).toBe(false);
  });

  it("rejects hotels and cinemas that merely contain a bar", () => {
    // A hotel's primary type is lodging even if it has a bar secondary type.
    expect(matchesCategoryPrimaryType("pub", "lodging")).toBe(false);
    expect(matchesCategoryPrimaryType("pub", "movie_theater")).toBe(false);
    expect(matchesCategoryPrimaryType("pub", undefined)).toBe(false);
  });
});

describe("travelModeToGoogle", () => {
  it("maps supported modes", () => {
    expect(travelModeToGoogle("transit")).toBe("TRANSIT");
    expect(travelModeToGoogle("walking")).toBe("WALK");
    expect(travelModeToGoogle("driving")).toBe("DRIVE");
  });

  it("rejects cycling, which the matrix endpoint cannot do", () => {
    expect(() => travelModeToGoogle("cycling")).toThrow();
  });
});

describe("transitPreferencesToGoogle", () => {
  it("returns undefined when no preferences are given", () => {
    expect(transitPreferencesToGoogle(undefined)).toBeUndefined();
    expect(transitPreferencesToGoogle({})).toBeUndefined();
  });

  it("maps allowed submodes to the Routes API enum", () => {
    expect(
      transitPreferencesToGoogle({ allowedModes: ["subway", "train", "light_rail", "rail"] }),
    ).toEqual({
      allowedTravelModes: ["SUBWAY", "TRAIN", "LIGHT_RAIL", "RAIL"],
    });
  });

  it("maps the routing preference", () => {
    expect(transitPreferencesToGoogle({ routingPreference: "fewer_transfers" })).toEqual({
      routingPreference: "FEWER_TRANSFERS",
    });
    expect(transitPreferencesToGoogle({ routingPreference: "less_walking" })).toEqual({
      routingPreference: "LESS_WALKING",
    });
  });

  it("combines submodes and routing preference", () => {
    expect(
      transitPreferencesToGoogle({
        allowedModes: ["bus"],
        routingPreference: "less_walking",
      }),
    ).toEqual({
      allowedTravelModes: ["BUS"],
      routingPreference: "LESS_WALKING",
    });
  });

  it("ignores an empty allowed submodes list", () => {
    expect(transitPreferencesToGoogle({ allowedModes: [] })).toBeUndefined();
  });
});

describe("parseDurationSeconds", () => {
  it("parses protobuf duration strings", () => {
    expect(parseDurationSeconds("1234s")).toBe(1234);
    expect(parseDurationSeconds("60.5s")).toBe(61);
    expect(parseDurationSeconds("0s")).toBe(0);
  });

  it("accepts raw numbers", () => {
    expect(parseDurationSeconds(90)).toBe(90);
  });

  it("returns null for invalid input", () => {
    expect(parseDurationSeconds("abc")).toBeNull();
    expect(parseDurationSeconds(undefined)).toBeNull();
    expect(parseDurationSeconds("12")).toBeNull();
  });
});
