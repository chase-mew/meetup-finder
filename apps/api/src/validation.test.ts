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
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.objective).toBe("min_variance");
      expect(result.value.travelWeight).toBe(0.6);
      expect(result.value.limit).toBe(3);
      expect(result.value.openNow).toBe(true);
    }
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
});
