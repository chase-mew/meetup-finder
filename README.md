# Meetup Finder

Find the fairest place to meet. Enter where everyone is starting from in London, pick a category (Cafe, Lunch, Dinner, Pub), and get the best places to meet ranked by real public transport travel time blended with venue star rating.

The default objective is the fairest worst case travel (nobody travels too far), with optional advanced controls for the objective and how much rating matters.

## Why it is different

Most "meet in the middle" tools compute a simple geographic midpoint. Meetup Finder scores real venues by the actual transit time from every person, using a selectable fairness objective and factoring in the venue rating.

## Workspace layout

This is a pnpm workspace.

- `packages/core` Pure TypeScript scoring engine. Geometric median seed, fairness objectives (`min_total`, `min_max`, `min_variance`), Bayesian rating blend, and ranking. No network, fully unit tested.
- `packages/providers` `PlacesProvider`, `TravelProvider`, and `AutocompleteProvider` interfaces plus Google adapters (Geocoding, Places API New text search and autocomplete, Routes API transit matrix). Vendor specifics live only here.
- `apps/api` Cloudflare Worker (Hono) exposing `POST /api/search`, `GET /api/geocode`, `GET /api/autocomplete`, and `GET /api/place`. Reads `GOOGLE_MAPS_API_KEY` from env. Runs locally via `wrangler dev`.
- `apps/web` React + TypeScript + Vite front end.

## Getting started

```bash
pnpm install
pnpm test
```

### Run the API locally

Create `apps/api/.dev.vars` with your key:

```
GOOGLE_MAPS_API_KEY=your_key_here
```

Then:

```bash
pnpm dev:api
```

### Run the web app

Set the API base URL if needed in `apps/web/.env.local` (defaults to the local worker):

```
VITE_API_BASE_URL=http://localhost:8787
```

Then:

```bash
pnpm dev:web
```

## Scripts

- `pnpm test` Run every package test suite (offline, no API calls).
- `pnpm typecheck` Type check every package.
- `pnpm build` Build every package.
- `pnpm smoke` Run a live end to end check against a running Worker (see below).
- `pnpm test:integration` Run the opt in live Google tests (needs a key).

## Smoke test

With the Worker running (`pnpm dev:api`) and a real key in `apps/api/.dev.vars`:

```bash
pnpm smoke
```

It geocodes a few London addresses, runs a real search, and prints the ranked venues with each person's travel time. Point it elsewhere with `API_BASE=https://your-worker.workers.dev pnpm smoke`.

## Integration tests

`apps/api` has live tests that call the real Google APIs. They are skipped by default so normal runs stay offline and free. To run them (this costs a small amount):

```bash
pnpm test:integration
```

They read the key from the environment, or fall back to `apps/api/.dev.vars`.

## Provider keys

The MVP uses Google Maps Platform. Enable these APIs on your key: Geocoding API, Places API (New), and Routes API. Restrict the key before deploying.

## Caching

The Worker caches geocode lookups and search results. Keys for searches round each origin to about 110 metres and are order independent, so nearby addresses and a different input order reuse the same result. With no KV namespace bound it uses an in memory cache per isolate. To make the cache durable across isolates, create a KV namespace and bind it (see `apps/api/wrangler.toml`).

## Rate limiting and abuse protection

Each search fans out into several paid Google calls, so the public Worker throttles its paid endpoints (`POST /api/search` and `GET /api/geocode`) to keep cost bounded. Throttling is a per client token bucket keyed by `cf-connecting-ip`, with an optional global daily ceiling as a backstop. When a client exceeds its limit the Worker replies with HTTP 429, a `Retry-After` header, and a friendly `error` message that the web app surfaces.

Limit state lives in the `CACHE` KV namespace when one is bound, so it is shared across isolates. Without KV it falls back to an in memory store per isolate. KV is eventually consistent, so the bucket is a best effort guardrail aimed at bounding cost rather than enforcing an exact quota.

Everything is configurable through environment variables in `apps/api/wrangler.toml` (or as secrets):

- `RATE_LIMIT_ENABLED` set to `"false"` to disable throttling entirely. Defaults to on.
- `RATE_LIMIT_RPM` sustained requests per minute per client. Default `30`.
- `RATE_LIMIT_BURST` bucket capacity, the largest burst a client can make at once. Default `15`.
- `RATE_LIMIT_DAILY_MAX` global daily request ceiling across all clients. `0` disables it (the default).

## Deployment

The Worker and the web app deploy separately.

### Worker (apps/api)

```bash
npx wrangler login
cd apps/api
npx wrangler secret put GOOGLE_MAPS_API_KEY
# Optional durable cache:
#   npx wrangler kv namespace create CACHE
#   then add the id to wrangler.toml and uncomment the [[kv_namespaces]] block
pnpm deploy
```

Note the deployed URL, for example `https://meetup-finder-api.your-subdomain.workers.dev`.

### Web (apps/web) on Cloudflare Pages

```bash
# Point the build at the deployed Worker
echo "VITE_API_BASE_URL=https://meetup-finder-api.your-subdomain.workers.dev" > apps/web/.env.local
pnpm --filter @meetup/web build
npx wrangler pages deploy apps/web/dist --project-name meetup-finder
```

CORS is already enabled on the Worker, so the Pages site can call it cross origin.

## Continuous integration and deployment

Two GitHub Actions workflows live in `.github/workflows`:

- `ci.yml` runs on every pull request and on pushes to `main`: install, typecheck, test, build.
- `deploy.yml` runs on pushes to `main`: it tests, deploys the Worker, uploads the Google key as a Worker secret, then builds and deploys the web app to Pages.

For `deploy.yml`, set these in the repository under Settings, then Secrets and variables, then Actions.

Secrets:
- `CLOUDFLARE_API_TOKEN` with permissions Workers Scripts Edit, Cloudflare Pages Edit, and Workers KV Storage Edit.
- `CLOUDFLARE_ACCOUNT_ID` your account id.
- `GOOGLE_MAPS_API_KEY` your Google key.

Variable:
- `VITE_API_BASE_URL` the deployed Worker URL.

The Pages project is created automatically on the first deploy if it does not already exist.
