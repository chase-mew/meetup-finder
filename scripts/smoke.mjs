#!/usr/bin/env node
// Live smoke test against a running Worker (default http://localhost:8787).
// Geocodes a few London addresses, runs a real search, and prints the result.
//
// Usage:
//   node scripts/smoke.mjs
//   API_BASE=https://your-worker.workers.dev node scripts/smoke.mjs

const BASE = process.env.API_BASE ?? "http://localhost:8787";

const DEFAULT_PEOPLE = [
  { label: "Alice", query: "King's Cross Station, London" },
  { label: "Bob", query: "Waterloo Station, London" },
  { label: "Carol", query: "Camden Town, London" },
];

// Override with SMOKE_PEOPLE, a JSON array of { label, query }.
const PEOPLE = process.env.SMOKE_PEOPLE ? JSON.parse(process.env.SMOKE_PEOPLE) : DEFAULT_PEOPLE;

const CATEGORY = process.env.SMOKE_CATEGORY ?? "cafe";
const MODE = process.env.SMOKE_MODE ?? "transit";

function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined) return "no route";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

async function getJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? "GET"} ${url} -> ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function main() {
  console.log(`Smoke testing ${BASE}\n`);

  const health = await getJson(`${BASE}/api/health`);
  console.log("health:", JSON.stringify(health));

  const origins = [];
  for (const person of PEOPLE) {
    const result = await getJson(`${BASE}/api/geocode?q=${encodeURIComponent(person.query)}`);
    console.log(
      `geocoded ${person.label.padEnd(6)} "${person.query}" -> ${result.formattedAddress}`,
    );
    origins.push({
      id: person.label.toLowerCase(),
      label: person.label,
      location: result.location,
    });
  }

  console.log(`\nSearching for "${CATEGORY}" by "${MODE}"...\n`);
  const search = await getJson(`${BASE}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origins, category: CATEGORY, mode: MODE, limit: 5 }),
  });

  console.log(
    `Meeting area seed: ${search.seed.lat.toFixed(4)}, ${search.seed.lng.toFixed(4)} ` +
      `(search radius ${search.searchRadiusMeters} m, objective ${search.objective})\n`,
  );

  if (search.venues.length === 0) {
    console.log("No venues returned. Try a different category or a larger radius.");
    return;
  }

  search.venues.forEach((venue, index) => {
    const rating = venue.rating ? `${venue.rating}* (${venue.ratingCount ?? 0})` : "no rating";
    console.log(`${index + 1}. ${venue.name}  [${rating}]`);
    console.log(`   longest trip ${fmtDuration(venue.maxSeconds)}, total ${fmtDuration(venue.totalSeconds)}`);
    for (const leg of venue.legs) {
      console.log(`     ${(leg.originLabel ?? leg.originId).padEnd(8)} ${fmtDuration(leg.durationSeconds)}`);
    }
  });

  console.log("\nSmoke test passed.");
}

main().catch((error) => {
  console.error("\nSmoke test FAILED:");
  console.error(error.message);
  process.exit(1);
});
