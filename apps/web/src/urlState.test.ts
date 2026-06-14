import { describe, expect, it } from "vitest";
import {
  type SearchUrlState,
  decodeSearchState,
  encodeSearchState,
  roundCoord,
} from "./urlState";

const sampleState: SearchUrlState = {
  origins: [
    { label: "Alice", location: { lat: 51.50735, lng: -0.12776 } },
    { label: "Bob", location: { lat: 51.49, lng: -0.1 } },
  ],
  category: "dinner",
  mode: "walking",
  objective: "min_max",
  ratingWeight: 0.4,
  limit: 8,
  openNow: true,
};

describe("encode then decode round trip", () => {
  it("reproduces the original state", () => {
    const decoded = decodeSearchState(encodeSearchState(sampleState));
    expect(decoded).toEqual(sampleState);
  });

  it("preserves three or more origins", () => {
    const state: SearchUrlState = {
      ...sampleState,
      origins: [
        { label: "A", location: { lat: 51.5, lng: -0.1 } },
        { label: "B", location: { lat: 51.4, lng: -0.2 } },
        { label: "C", location: { lat: 51.6, lng: -0.05 } },
      ],
    };
    expect(decodeSearchState(encodeSearchState(state))).toEqual(state);
  });

  it("keeps labels that contain commas and spaces", () => {
    const state: SearchUrlState = {
      ...sampleState,
      origins: [
        { label: "King's Cross, London", location: { lat: 51.53, lng: -0.123 } },
        { label: "", location: { lat: 51.49, lng: -0.1 } },
      ],
    };
    expect(decodeSearchState(encodeSearchState(state))).toEqual(state);
  });
});

describe("roundCoord", () => {
  it("rounds to five decimals", () => {
    expect(roundCoord(51.5073509123)).toBe(51.50735);
    expect(roundCoord(-0.127762345)).toBe(-0.12776);
  });
});

describe("decodeSearchState", () => {
  it("returns null when there are no origins", () => {
    expect(decodeSearchState("")).toBeNull();
    expect(decodeSearchState("?cat=cafe&mode=transit")).toBeNull();
  });

  it("ignores a leading question mark", () => {
    const query = encodeSearchState(sampleState);
    expect(decodeSearchState(`?${query}`)).toEqual(sampleState);
  });

  it("skips malformed origins but keeps valid ones", () => {
    const decoded = decodeSearchState("o=not-a-coord&o=51.5,-0.1,Alice");
    expect(decoded?.origins).toEqual([{ label: "Alice", location: { lat: 51.5, lng: -0.1 } }]);
  });

  it("rejects out of range coordinates", () => {
    expect(decodeSearchState("o=200,400,Bad")).toBeNull();
  });

  it("falls back to defaults for missing or invalid fields", () => {
    const decoded = decodeSearchState("o=51.5,-0.1,Alice&o=51.4,-0.2,Bob");
    expect(decoded).toEqual({
      origins: [
        { label: "Alice", location: { lat: 51.5, lng: -0.1 } },
        { label: "Bob", location: { lat: 51.4, lng: -0.2 } },
      ],
      category: "cafe",
      mode: "transit",
      objective: "best",
      ratingWeight: 0.3,
      limit: 5,
      openNow: false,
    });
  });

  it("falls back to defaults when enum values are unknown", () => {
    const decoded = decodeSearchState(
      "o=51.5,-0.1,Alice&o=51.4,-0.2,Bob&cat=nightclub&mode=teleport&obj=fastest",
    );
    expect(decoded?.category).toBe("cafe");
    expect(decoded?.mode).toBe("transit");
    expect(decoded?.objective).toBe("best");
  });

  it("clamps the rating weight to the 0..1 range", () => {
    expect(decodeSearchState("o=51.5,-0.1,A&o=51.4,-0.2,B&rw=2")?.ratingWeight).toBe(1);
    expect(decodeSearchState("o=51.5,-0.1,A&o=51.4,-0.2,B&rw=-1")?.ratingWeight).toBe(0);
    expect(decodeSearchState("o=51.5,-0.1,A&o=51.4,-0.2,B&rw=foo")?.ratingWeight).toBe(0.3);
  });

  it("rejects a non positive or fractional limit", () => {
    expect(decodeSearchState("o=51.5,-0.1,A&o=51.4,-0.2,B&limit=0")?.limit).toBe(5);
    expect(decodeSearchState("o=51.5,-0.1,A&o=51.4,-0.2,B&limit=2.5")?.limit).toBe(5);
    expect(decodeSearchState("o=51.5,-0.1,A&o=51.4,-0.2,B&limit=8")?.limit).toBe(8);
  });

  it("clamps the limit to the maximum the API allows", () => {
    expect(decodeSearchState("o=51.5,-0.1,A&o=51.4,-0.2,B&limit=50")?.limit).toBe(10);
  });
});
