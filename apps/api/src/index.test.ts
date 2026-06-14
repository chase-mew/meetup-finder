import { describe, expect, it } from "vitest";
import { parseCoord } from "./index";

describe("parseCoord", () => {
  it("parses valid coordinates", () => {
    expect(parseCoord("51.5", 90)).toBe(51.5);
    expect(parseCoord("-0.12", 180)).toBe(-0.12);
  });

  it("accepts boundary values", () => {
    expect(parseCoord("90", 90)).toBe(90);
    expect(parseCoord("-90", 90)).toBe(-90);
    expect(parseCoord("180", 180)).toBe(180);
  });

  it("rejects values beyond the limit", () => {
    expect(parseCoord("90.001", 90)).toBeNull();
    expect(parseCoord("-180.5", 180)).toBeNull();
  });

  it("rejects empty, missing and whitespace input", () => {
    expect(parseCoord(undefined, 90)).toBeNull();
    expect(parseCoord("", 90)).toBeNull();
    expect(parseCoord("   ", 90)).toBeNull();
  });

  it("rejects non-numeric and non-finite input", () => {
    expect(parseCoord("abc", 90)).toBeNull();
    expect(parseCoord("NaN", 90)).toBeNull();
    expect(parseCoord("Infinity", 90)).toBeNull();
  });
});
