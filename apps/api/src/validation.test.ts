import { describe, expect, it } from "vitest";
import { validateSearchRequest } from "./validation";

const validBody = {
  origins: [
    { id: "a", location: { lat: 51.53, lng: -0.12 } },
    { id: "b", location: { lat: 51.5, lng: -0.11 } },
  ],
  category: "cafe",
  mode: "transit",
};

describe("validateSearchRequest", () => {
  it("accepts a valid body and defaults the mode to transit", () => {
    const result = validateSearchRequest({ ...validBody, mode: undefined });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe("transit");
      expect(result.value.origins).toHaveLength(2);
    }
  });

  it("rejects fewer than two origins", () => {
    const result = validateSearchRequest({ ...validBody, origins: [validBody.origins[0]] });
    expect(result).toMatchObject({ ok: false });
  });

  it("rejects more than ten origins", () => {
    const origins = Array.from({ length: 11 }, (_, i) => ({
      id: `o${i}`,
      location: { lat: 51.5, lng: -0.1 },
    }));
    expect(validateSearchRequest({ ...validBody, origins }).ok).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(validateSearchRequest({ ...validBody, category: "nightclub" }).ok).toBe(false);
  });

  it("accepts the best objective", () => {
    const result = validateSearchRequest({ ...validBody, objective: "best" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.objective).toBe("best");
    }
  });

  it("rejects cycling, which the matrix cannot do", () => {
    expect(validateSearchRequest({ ...validBody, mode: "cycling" }).ok).toBe(false);
  });

  it("rejects an invalid location", () => {
    const result = validateSearchRequest({
      ...validBody,
      origins: [
        { id: "a", location: { lat: 999, lng: -0.12 } },
        { id: "b", location: { lat: 51.5, lng: -0.11 } },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects weights outside 0..1", () => {
    expect(validateSearchRequest({ ...validBody, travelWeight: 2 }).ok).toBe(false);
  });

  it("rejects a non integer limit", () => {
    expect(validateSearchRequest({ ...validBody, limit: 2.5 }).ok).toBe(false);
  });

  it("carries through the advanced options", () => {
    const result = validateSearchRequest({
      ...validBody,
      objective: "min_variance",
      travelWeight: 0.6,
      ratingWeight: 0.4,
      limit: 3,
      openNow: true,
      meetTime: "12:30",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.objective).toBe("min_variance");
      expect(result.value.travelWeight).toBe(0.6);
      expect(result.value.limit).toBe(3);
      expect(result.value.openNow).toBe(true);
      expect(result.value.meetTime).toBe("12:30");
    }
  });

  it("rejects a malformed meet time", () => {
    expect(validateSearchRequest({ ...validBody, meetTime: "25:00" }).ok).toBe(false);
    expect(validateSearchRequest({ ...validBody, meetTime: "noon" }).ok).toBe(false);
  });

  it("carries through valid transit preferences", () => {
    const result = validateSearchRequest({
      ...validBody,
      transit: {
        allowedModes: ["subway", "train", "rail", "subway"],
        routingPreference: "fewer_transfers",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.transit).toEqual({
        // Duplicates are de-duplicated, order preserved.
        allowedModes: ["subway", "train", "rail"],
        routingPreference: "fewer_transfers",
      });
    }
  });

  it("leaves transit undefined when not provided", () => {
    const result = validateSearchRequest(validBody);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.transit).toBeUndefined();
    }
  });

  it("rejects an unknown transit submode", () => {
    expect(
      validateSearchRequest({ ...validBody, transit: { allowedModes: ["helicopter"] } }).ok,
    ).toBe(false);
  });

  it("rejects an unknown transit routing preference", () => {
    expect(
      validateSearchRequest({ ...validBody, transit: { routingPreference: "teleport" } }).ok,
    ).toBe(false);
  });

  it("rejects a non object transit value", () => {
    expect(validateSearchRequest({ ...validBody, transit: "rail" }).ok).toBe(false);
  });

  it("carries through valid place filters and dedupes price levels", () => {
    const result = validateSearchRequest({
      ...validBody,
      category: "dinner",
      priceLevels: [2, 1, 2],
      minRating: 4,
      cuisines: ["Indian", " Thai ", "Indian"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.priceLevels).toEqual([2, 1]);
      expect(result.value.minRating).toBe(4);
      expect(result.value.cuisines).toEqual(["Indian", "Thai"]);
    }
  });

  it("leaves place filters undefined when not provided or empty", () => {
    const result = validateSearchRequest({ ...validBody, priceLevels: [], cuisines: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.priceLevels).toBeUndefined();
      expect(result.value.minRating).toBeUndefined();
      expect(result.value.cuisines).toBeUndefined();
    }
  });

  it("rejects price levels outside 1..4", () => {
    expect(validateSearchRequest({ ...validBody, priceLevels: [0] }).ok).toBe(false);
    expect(validateSearchRequest({ ...validBody, priceLevels: [5] }).ok).toBe(false);
    expect(validateSearchRequest({ ...validBody, priceLevels: [2.5] }).ok).toBe(false);
    expect(validateSearchRequest({ ...validBody, priceLevels: "cheap" }).ok).toBe(false);
  });

  it("rejects a minimum rating outside 0..5", () => {
    expect(validateSearchRequest({ ...validBody, minRating: -1 }).ok).toBe(false);
    expect(validateSearchRequest({ ...validBody, minRating: 6 }).ok).toBe(false);
    expect(validateSearchRequest({ ...validBody, minRating: "good" }).ok).toBe(false);
  });

  it("rejects too many or overlong cuisines", () => {
    const tooMany = Array.from({ length: 9 }, (_, i) => `c${i}`);
    expect(validateSearchRequest({ ...validBody, cuisines: tooMany }).ok).toBe(false);
    expect(validateSearchRequest({ ...validBody, cuisines: ["x".repeat(41)] }).ok).toBe(false);
    expect(validateSearchRequest({ ...validBody, cuisines: [123] }).ok).toBe(false);
  });
});
