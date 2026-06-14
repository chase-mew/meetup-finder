import { describe, expect, it, vi } from "vitest";
import { GoogleTravelProvider, parseMatrixElements } from "./routes";
import type { LatLng } from "@meetup/core";

describe("parseMatrixElements", () => {
  it("parses existing routes and defaults missing indices to zero", () => {
    const cells = parseMatrixElements([
      { destinationIndex: 1, condition: "ROUTE_EXISTS", duration: "600s", distanceMeters: 4000 },
      { originIndex: 0, destinationIndex: 0, condition: "ROUTE_EXISTS", duration: "300s" },
    ]);
    expect(cells[0]).toMatchObject({
      originIndex: 0,
      destinationIndex: 1,
      durationSeconds: 600,
      distanceMeters: 4000,
    });
    expect(cells[1]!.durationSeconds).toBe(300);
  });

  it("returns null duration when no route exists", () => {
    const cells = parseMatrixElements([
      { originIndex: 0, destinationIndex: 0, condition: "ROUTE_NOT_FOUND" },
    ]);
    expect(cells[0]!.durationSeconds).toBeNull();
    expect(cells[0]!.distanceMeters).toBeNull();
  });

  it("applies a destination offset for chunked requests", () => {
    const cells = parseMatrixElements(
      [{ originIndex: 0, destinationIndex: 0, condition: "ROUTE_EXISTS", duration: "60s" }],
      33,
    );
    expect(cells[0]!.destinationIndex).toBe(33);
  });
});

describe("GoogleTravelProvider.matrix", () => {
  const origins: LatLng[] = [
    { lat: 51.5, lng: -0.1 },
    { lat: 51.51, lng: -0.12 },
    { lat: 51.52, lng: -0.14 },
  ];

  function makeDestinations(n: number): LatLng[] {
    return Array.from({ length: n }, (_, i) => ({ lat: 51.5 + i * 0.001, lng: -0.1 }));
  }

  it("chunks transit requests to stay under the 100 element cap", async () => {
    const destinations = makeDestinations(50);
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      const destCount = body.destinations.length;
      const originCount = body.origins.length;
      const elements = [];
      for (let o = 0; o < originCount; o += 1) {
        for (let d = 0; d < destCount; d += 1) {
          elements.push({
            originIndex: o,
            destinationIndex: d,
            condition: "ROUTE_EXISTS",
            duration: "600s",
          });
        }
      }
      return new Response(JSON.stringify(elements), { status: 200 });
    });

    const provider = new GoogleTravelProvider({ apiKey: "k", fetchImpl });
    const result = await provider.matrix({ origins, destinations, mode: "transit" });

    // 3 origins => floor(100/3)=33 destinations per request => 2 requests.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.cells).toHaveLength(150);
    const maxDestIndex = Math.max(...result.cells.map((c) => c.destinationIndex));
    expect(maxDestIndex).toBe(49);
    // No request should exceed the element cap.
    for (const call of fetchImpl.mock.calls) {
      const body = JSON.parse(String((call[1] as RequestInit).body));
      expect(body.origins.length * body.destinations.length).toBeLessThanOrEqual(100);
    }
  });

  it("runs chunks concurrently but within the concurrency limit", async () => {
    // 3 origins => 33 destinations per request => 10 chunks for 330 destinations.
    const destinations = makeDestinations(330);
    let active = 0;
    let maxActive = 0;
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const body = JSON.parse(String(init!.body));
      const destCount = body.destinations.length;
      const originCount = body.origins.length;
      const elements = [];
      for (let o = 0; o < originCount; o += 1) {
        for (let d = 0; d < destCount; d += 1) {
          elements.push({
            originIndex: o,
            destinationIndex: d,
            condition: "ROUTE_EXISTS",
            duration: "600s",
          });
        }
      }
      active -= 1;
      return new Response(JSON.stringify(elements), { status: 200 });
    });

    const provider = new GoogleTravelProvider({ apiKey: "k", fetchImpl });
    const result = await provider.matrix({ origins, destinations, mode: "transit" });

    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(result.cells).toHaveLength(3 * 330);
    const maxDestIndex = Math.max(...result.cells.map((c) => c.destinationIndex));
    expect(maxDestIndex).toBe(329);
  });

  it("propagates errors from a failing chunk", async () => {
    const destinations = makeDestinations(330);
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
    const provider = new GoogleTravelProvider({ apiKey: "k", fetchImpl });
    await expect(
      provider.matrix({ origins, destinations, mode: "transit" }),
    ).rejects.toThrow();
  });

  it("returns empty cells when there are no destinations", async () => {
    const fetchImpl = vi.fn();
    const provider = new GoogleTravelProvider({ apiKey: "k", fetchImpl });
    const result = await provider.matrix({ origins, destinations: [], mode: "transit" });
    expect(result.cells).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
