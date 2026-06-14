import { describe, expect, it } from "vitest";
import {
  categoryToIncludedTypes,
  parseDurationSeconds,
  travelModeToGoogle,
} from "./shared";

describe("categoryToIncludedTypes", () => {
  it("maps each category to Places types", () => {
    expect(categoryToIncludedTypes("cafe")).toContain("cafe");
    expect(categoryToIncludedTypes("lunch")).toEqual(["restaurant"]);
    expect(categoryToIncludedTypes("dinner")).toEqual(["restaurant"]);
    expect(categoryToIncludedTypes("pub")).toContain("pub");
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
