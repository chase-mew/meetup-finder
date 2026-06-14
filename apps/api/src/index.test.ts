import { afterEach, describe, expect, it, vi } from "vitest";
import app, { parseCoord } from "./index";

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

const KEY = "test-key";

function searchBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    origins: [
      { id: "a", location: { lat: 51.5308, lng: -0.1238 } },
      { id: "b", location: { lat: 51.5036, lng: -0.1144 } },
    ],
    category: "cafe",
    mode: "transit",
    ...overrides,
  });
}

function post(body: string, env: Record<string, unknown> = { GOOGLE_MAPS_API_KEY: KEY }) {
  return app.request(
    "/api/search",
    { method: "POST", headers: { "Content-Type": "application/json" }, body },
    env,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("worker error handling", () => {
  it("serves health", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "meetup-finder-api" });
  });

  it("returns a hidden config error when the API key is missing", async () => {
    const res = await post(searchBody(), {});
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("config_error");
    expect(body.error).not.toContain("GOOGLE_MAPS_API_KEY");
  });

  it("returns a validation error for invalid JSON", async () => {
    const res = await post("{ not json");
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({ code: "validation_error" });
  });

  it("returns a validation error for a bad body", async () => {
    const res = await post(searchBody({ origins: [{ id: "a", location: { lat: 1, lng: 1 } }] }));
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({ code: "validation_error" });
  });

  it("maps an upstream provider failure to a 502 provider error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const res = await post(searchBody());
    expect(res.status).toBe(502);
    expect((await res.json()) as { code: string }).toMatchObject({ code: "provider_error" });
  });
});
