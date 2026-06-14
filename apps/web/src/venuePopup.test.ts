import type { ResultVenue } from "@meetup/core";
import { describe, expect, it } from "vitest";
import { escapeHtml, venuePopupHtml } from "./venuePopup";

function makeVenue(overrides: Partial<ResultVenue> = {}): ResultVenue {
  return {
    id: "v1",
    name: "Test Venue",
    location: { lat: 51.5, lng: -0.1 },
    reachable: true,
    finalScore: 0.2,
    bayesianRating: 4.4,
    objectiveCostSeconds: 600,
    totalSeconds: 1200,
    maxSeconds: 900,
    normalizedTravel: 0.1,
    normalizedRating: 0.7,
    legs: [],
    ...overrides,
  };
}

describe("escapeHtml", () => {
  it("escapes the characters that could break markup", () => {
    expect(escapeHtml(`<b>"Joe's" & co</b>`)).toBe(
      "&lt;b&gt;&quot;Joe&#39;s&quot; &amp; co&lt;/b&gt;",
    );
  });
});

describe("venuePopupHtml", () => {
  it("includes the rich detail when present", () => {
    const html = venuePopupHtml(
      makeVenue({
        name: "Cafe One",
        rating: 4.6,
        ratingCount: 1500,
        priceLevel: 2,
        maxSeconds: 1800,
        photoRef: "places/abc/photos/xyz",
        googleMapsUri: "https://maps.google.com/?cid=1",
      }),
      1,
    );

    expect(html).toContain("Cafe One");
    expect(html).toContain("map-popup__photo");
    expect(html).toContain("4.6");
    expect(html).toContain("(1.5k)");
    expect(html).toContain("££");
    expect(html).toContain("Longest trip");
    expect(html).toContain("30 min");
    expect(html).toContain('href="https://maps.google.com/?cid=1"');
    expect(html).toContain("Directions");
    expect(html).toContain(">1</span>");
  });

  it("omits optional sections when data is missing", () => {
    const html = venuePopupHtml(
      makeVenue({ rating: undefined, priceLevel: undefined, photoRef: undefined }),
    );

    expect(html).not.toContain("map-popup__photo");
    expect(html).not.toContain("map-popup__meta");
    expect(html).not.toContain("Directions");
    expect(html).toContain("Longest trip");
  });

  it("escapes venue names to keep the markup safe", () => {
    const html = venuePopupHtml(makeVenue({ name: `<script>alert("x")</script>` }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
