import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GoogleGeocodingProvider,
  GooglePlacesProvider,
  GoogleTravelProvider,
} from "@meetup/providers";
import { describe, expect, it } from "vitest";
import { runSearch } from "./search";

// These tests call the real Google APIs and cost a small amount per run.
// They are opt in: they only execute when RUN_INTEGRATION=1 and a key is
// available (from the environment or apps/api/.dev.vars). Run them with:
//   pnpm test:integration
// They are skipped in normal test runs and in CI.

function loadKey(): string | undefined {
  if (process.env.GOOGLE_MAPS_API_KEY) {
    return process.env.GOOGLE_MAPS_API_KEY;
  }
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const file = path.resolve(dir, "..", ".dev.vars");
    const content = fs.readFileSync(file, "utf8");
    const match = content.match(/^GOOGLE_MAPS_API_KEY=(.+)$/m);
    const value = match?.[1]?.trim();
    return value && !value.startsWith("placeholder") ? value : undefined;
  } catch {
    return undefined;
  }
}

const apiKey = loadKey();
const enabled = process.env.RUN_INTEGRATION === "1" && Boolean(apiKey);

describe.skipIf(!enabled)("Google integration (live)", () => {
  const key = apiKey as string;

  it("geocodes a London address", async () => {
    const provider = new GoogleGeocodingProvider({ apiKey: key });
    const result = await provider.geocode("Waterloo Station, London");
    expect(result).not.toBeNull();
    expect(result!.location.lat).toBeGreaterThan(51);
    expect(result!.location.lat).toBeLessThan(52);
  }, 30_000);

  it("runs the full search pipeline with real providers", async () => {
    const deps = {
      places: new GooglePlacesProvider({ apiKey: key }),
      travel: new GoogleTravelProvider({ apiKey: key }),
    };
    const result = await runSearch(deps, {
      origins: [
        { id: "a", label: "Alice", location: { lat: 51.5308, lng: -0.1238 } },
        { id: "b", label: "Bob", location: { lat: 51.5036, lng: -0.1144 } },
      ],
      category: "cafe",
      mode: "transit",
      limit: 3,
    });

    expect(result.venues.length).toBeGreaterThan(0);
    const top = result.venues[0]!;
    expect(top.legs).toHaveLength(2);
    expect(top.reachable).toBe(true);
    expect(top.maxSeconds).toBeGreaterThan(0);
  }, 45_000);
});
