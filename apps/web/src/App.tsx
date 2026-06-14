import {
  type Objective,
  SEARCH_DEFAULTS,
  type SearchRequestBody,
  type SearchResponseBody,
  type TransitPreferences,
  type TransitTravelMode,
  type TravelMode,
  type VenueCategory,
} from "@meetup/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiClientError,
  type AutocompletePrediction,
  geocode,
  placeDetails,
  reverseGeocode,
  search,
} from "./api";
import { type Favourite } from "./favourites";
import { reportError } from "./reporting";
import { AdvancedControls, type TransitRoutingChoice } from "./components/AdvancedControls";
import { CategoryPicker } from "./components/CategoryPicker";
import { LogoMark, MeetIcon, MoonIcon, SunIcon } from "./components/icons";
import { LoadingResults } from "./components/LoadingResults";
import { MapView, type MapOrigin } from "./components/MapView";
import { ModePicker } from "./components/ModePicker";
import { OriginsForm } from "./components/OriginsForm";
import { ResultsList } from "./components/ResultsList";
import type { Person } from "./types";
import {
  buildShareUrl,
  readSearchStateFromUrl,
  type SearchUrlState,
  writeSearchStateToUrl,
} from "./urlState";
import { useFavourites } from "./useFavourites";
import { useTheme } from "./useTheme";

const MAX_PEOPLE = 10;

// Allow-list of transit submodes used when the user opts to exclude buses.
const NON_BUS_TRANSIT_MODES: TransitTravelMode[] = ["subway", "train", "light_rail", "rail"];

/** Build a transit preferences object from the advanced controls, or undefined. */
function buildTransitPreferences(
  mode: TravelMode,
  excludeBuses: boolean,
  routing: TransitRoutingChoice,
): TransitPreferences | undefined {
  if (mode !== "transit") {
    return undefined;
  }
  const preferences: TransitPreferences = {};
  if (excludeBuses) {
    preferences.allowedModes = NON_BUS_TRANSIT_MODES;
  }
  if (routing !== "any") {
    preferences.routingPreference = routing;
  }
  return Object.keys(preferences).length > 0 ? preferences : undefined;
}

/** A search failure, tagged so the UI can phrase server vs request problems. */
interface SearchError {
  message: string;
  kind: "server" | "request" | "network";
}

function toSearchError(error: unknown): SearchError {
  if (error instanceof ApiClientError) {
    if (error.code === "network_error") {
      return { message: error.message, kind: "network" };
    }
    return { message: error.message, kind: error.isServerError ? "server" : "request" };
  }
  const message = error instanceof Error ? error.message : "Search failed";
  return { message, kind: "server" };
}

function newPerson(): Person {
  return {
    id: crypto.randomUUID(),
    label: "",
    address: "",
    status: "idle",
  };
}

function formatCoords(location: { lat: number; lng: number }): string {
  return `${location.lat}, ${location.lng}`;
}

function personFromUrlOrigin(origin: SearchUrlState["origins"][number]): Person {
  const coords = formatCoords(origin.location);
  return {
    id: crypto.randomUUID(),
    label: origin.label,
    address: origin.label.trim() || coords,
    location: origin.location,
    resolvedAddress: coords,
    status: "ok",
  };
}

function needsResolve(person: Person): boolean {
  return (
    person.address.trim().length > 0 &&
    !(person.status === "ok" && person.location !== undefined)
  );
}

async function resolveOne(person: Person): Promise<Person> {
  const query = person.address.trim();
  if (!query) {
    return { ...person, status: "idle", location: undefined, resolvedAddress: undefined };
  }
  try {
    const result = await geocode(query);
    if (!result) {
      return { ...person, status: "error", error: "No match found", location: undefined };
    }
    return {
      ...person,
      status: "ok",
      location: result.location,
      resolvedAddress: result.formattedAddress,
      error: undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lookup failed";
    return { ...person, status: "error", error: message, location: undefined };
  }
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 60_000,
    });
  });
}

function geolocationMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    switch ((error as GeolocationPositionError).code) {
      case 1:
        return "Location permission was denied. Enter your address instead.";
      case 2:
        return "Your location is unavailable right now. Enter your address instead.";
      case 3:
        return "Getting your location timed out. Try again or enter your address.";
    }
  }
  return "Could not get your location. Enter your address instead.";
}

function coordLabel(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const { favourites, saveFavourite, deleteFavourite } = useFavourites();
  const [people, setPeople] = useState<Person[]>(() => [newPerson(), newPerson()]);
  const [category, setCategory] = useState<VenueCategory>("cafe");
  const [mode, setMode] = useState<TravelMode>("transit");
  const [objective, setObjective] = useState<Objective>(SEARCH_DEFAULTS.objective);
  const [ratingWeight, setRatingWeight] = useState<number>(SEARCH_DEFAULTS.ratingWeight);
  const [limit, setLimit] = useState<number>(SEARCH_DEFAULTS.limit);
  const [openNow, setOpenNow] = useState(false);
  const [priceLevels, setPriceLevels] = useState<number[]>([]);
  const [minRating, setMinRating] = useState(0);
  const [cuisines, setCuisines] = useState<string[]>([]);
  const [meetTime, setMeetTime] = useState("");
  const [excludeBuses, setExcludeBuses] = useState(false);
  const [transitRouting, setTransitRouting] = useState<TransitRoutingChoice>("any");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SearchError | null>(null);
  const [result, setResult] = useState<SearchResponseBody | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  function updatePerson(id: string, patch: Partial<Person>) {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function addPerson() {
    setPeople((prev) => (prev.length >= MAX_PEOPLE ? prev : [...prev, newPerson()]));
  }

  function removePerson(id: string) {
    setPeople((prev) => (prev.length <= 2 ? prev : prev.filter((p) => p.id !== id)));
  }

  function saveFavouriteFromPerson(id: string) {
    const person = people.find((p) => p.id === id);
    if (!person || !person.location) {
      return;
    }
    const label = person.label.trim();
    if (!label) {
      return;
    }
    saveFavourite({
      id: crypto.randomUUID(),
      label,
      address: person.address,
      location: person.location,
      resolvedAddress: person.resolvedAddress,
    });
  }

  function insertFavourite(id: string, favourite: Favourite) {
    updatePerson(id, {
      label: favourite.label,
      address: favourite.address || favourite.resolvedAddress || formatCoords(favourite.location),
      location: favourite.location,
      resolvedAddress: favourite.resolvedAddress,
      status: "ok",
      error: undefined,
    });
  }

  const geolocationSupported = useMemo(
    () => typeof navigator !== "undefined" && "geolocation" in navigator,
    [],
  );

  async function useMyLocation(id: string) {
    if (!geolocationSupported) {
      updatePerson(id, {
        status: "error",
        error: "Location is not available in this browser. Enter your address instead.",
      });
      return;
    }

    updatePerson(id, { status: "locating", error: undefined });

    let position: GeolocationPosition;
    try {
      position = await getCurrentPosition();
    } catch (geoError) {
      updatePerson(id, { status: "error", error: geolocationMessage(geoError) });
      return;
    }

    const { latitude, longitude } = position.coords;
    const fallback = {
      status: "ok" as const,
      location: { lat: latitude, lng: longitude },
      address: coordLabel(latitude, longitude),
      resolvedAddress: undefined,
      error: undefined,
    };

    try {
      const result = await reverseGeocode(latitude, longitude);
      if (!result) {
        updatePerson(id, fallback);
        return;
      }
      updatePerson(id, {
        status: "ok",
        location: result.location,
        address: result.formattedAddress,
        resolvedAddress: result.formattedAddress,
        error: undefined,
      });
    } catch {
      // The coordinates are still usable even if the address lookup fails,
      // so fill them in rather than blocking the form.
      updatePerson(id, fallback);
    }
  }

  async function resolvePerson(id: string) {
    const person = people.find((p) => p.id === id);
    if (!person || !needsResolve(person)) {
      if (person && !person.address.trim()) {
        updatePerson(id, { status: "idle", location: undefined, resolvedAddress: undefined });
      }
      return;
    }
    updatePerson(id, { status: "loading" });
    const resolved = await resolveOne(person);
    setPeople((prev) => prev.map((p) => (p.id === id ? resolved : p)));
  }

  // Tracks the latest selection per person so out of order resolutions are dropped.
  const selectPlaceSeq = useRef<Map<string, number>>(new Map());

  async function selectPlace(id: string, prediction: AutocompletePrediction) {
    const seq = (selectPlaceSeq.current.get(id) ?? 0) + 1;
    selectPlaceSeq.current.set(id, seq);
    updatePerson(id, { address: prediction.description, status: "loading", error: undefined });
    try {
      const result = await placeDetails(prediction.placeId);
      if (selectPlaceSeq.current.get(id) !== seq) {
        return;
      }
      if (!result) {
        updatePerson(id, { status: "error", error: "No match found", location: undefined });
        return;
      }
      updatePerson(id, {
        status: "ok",
        location: result.location,
        resolvedAddress: result.formattedAddress,
        error: undefined,
      });
    } catch (error) {
      if (selectPlaceSeq.current.get(id) !== seq) {
        return;
      }
      const message = error instanceof Error ? error.message : "Lookup failed";
      updatePerson(id, { status: "error", error: message, location: undefined });
    }
  }

  const mapOrigins: MapOrigin[] = useMemo(
    () =>
      people
        .filter((p) => p.location)
        .map((p, index) => ({
          id: p.id,
          label: p.label.trim() || `Person ${index + 1}`,
          location: p.location!,
        })),
    [people],
  );

  const readyCount = people.filter((p) => p.address.trim().length > 0).length;
  const canSearch = readyCount >= 2 && !loading;

  async function executeSearch(
    origins: Array<{ id: string; label: string; location: { lat: number; lng: number } }>,
    options: {
      category: VenueCategory;
      mode: TravelMode;
      objective: Objective;
      ratingWeight: number;
      limit: number;
      openNow: boolean;
      priceLevels: number[];
      minRating: number;
      cuisines: string[];
      meetTime: string;
      excludeBuses: boolean;
      transitRouting: TransitRoutingChoice;
    },
  ) {
    if (origins.length < 2) {
      setError({
        message: "Enter at least two valid locations to find a meeting spot.",
        kind: "request",
      });
      return;
    }

    const usesMeetTime = options.category === "lunch" || options.category === "dinner";
    const usesCuisine = options.category === "lunch" || options.category === "dinner";
    const body: SearchRequestBody = {
      origins,
      category: options.category,
      mode: options.mode,
      objective: options.objective,
      travelWeight: Number((1 - options.ratingWeight).toFixed(2)),
      ratingWeight: Number(options.ratingWeight.toFixed(2)),
      limit: options.limit,
      openNow: options.openNow,
      priceLevels: options.priceLevels.length > 0 ? options.priceLevels : undefined,
      minRating: options.minRating > 0 ? options.minRating : undefined,
      cuisines: usesCuisine && options.cuisines.length > 0 ? options.cuisines : undefined,
      meetTime: usesMeetTime && options.meetTime ? options.meetTime : undefined,
      transit: buildTransitPreferences(options.mode, options.excludeBuses, options.transitRouting),
    };

    setLoading(true);
    try {
      const response = await search(body);
      setResult(response);
      setSelectedId(response.venues[0]?.id ?? null);

      const urlState: SearchUrlState = {
        origins: origins.map((origin) => ({ label: origin.label, location: origin.location })),
        category: options.category,
        mode: options.mode,
        objective: options.objective,
        ratingWeight: options.ratingWeight,
        limit: options.limit,
        openNow: options.openNow,
        priceLevels: options.priceLevels,
        minRating: options.minRating,
        cuisines: options.cuisines,
        meetTime: options.meetTime,
        excludeBuses: options.excludeBuses,
        transitRouting: options.transitRouting,
      };
      writeSearchStateToUrl(urlState);
      setShareUrl(buildShareUrl(urlState));
    } catch (searchError) {
      const parsed = toSearchError(searchError);
      // Only server and network faults are worth reporting; a 400 is the
      // client's own malformed request and would only add noise.
      if (parsed.kind !== "request") {
        reportError(searchError, {
          stage: "search",
          tags: { mode: options.mode, objective: options.objective },
        });
      }
      setError(parsed);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch() {
    setError(null);

    setPeople((prev) => prev.map((p) => (needsResolve(p) ? { ...p, status: "loading" } : p)));
    const resolved = await Promise.all(
      people.map((p) => (needsResolve(p) ? resolveOne(p) : Promise.resolve(p))),
    );
    setPeople(resolved);

    const origins = resolved
      .filter((p) => p.location)
      .map((p, index) => ({
        id: p.id,
        label: p.label.trim() || `Person ${index + 1}`,
        location: p.location!,
      }));

    await executeSearch(origins, {
      category,
      mode,
      objective,
      ratingWeight,
      limit,
      openNow,
      priceLevels,
      minRating,
      cuisines,
      meetTime,
      excludeBuses,
      transitRouting,
    });
  }

  const didLoadFromUrl = useRef(false);
  useEffect(() => {
    if (didLoadFromUrl.current) {
      return;
    }
    didLoadFromUrl.current = true;

    const urlState = readSearchStateFromUrl();
    if (!urlState) {
      return;
    }

    setCategory(urlState.category);
    setMode(urlState.mode);
    setObjective(urlState.objective);
    setRatingWeight(urlState.ratingWeight);
    setLimit(urlState.limit);
    setOpenNow(urlState.openNow);
    setPriceLevels(urlState.priceLevels);
    setMinRating(urlState.minRating);
    setCuisines(urlState.cuisines);
    setMeetTime(urlState.meetTime);
    setExcludeBuses(urlState.excludeBuses);
    setTransitRouting(urlState.transitRouting);
    if (
      urlState.objective !== SEARCH_DEFAULTS.objective ||
      urlState.ratingWeight !== SEARCH_DEFAULTS.ratingWeight ||
      urlState.limit !== SEARCH_DEFAULTS.limit ||
      urlState.openNow ||
      urlState.priceLevels.length > 0 ||
      urlState.minRating > 0 ||
      urlState.cuisines.length > 0 ||
      urlState.meetTime ||
      urlState.excludeBuses ||
      urlState.transitRouting !== "any"
    ) {
      setShowAdvanced(true);
    }

    const loadedPeople = urlState.origins.slice(0, MAX_PEOPLE).map(personFromUrlOrigin);
    setPeople(loadedPeople);

    if (loadedPeople.length >= 2) {
      const origins = loadedPeople.map((p, index) => ({
        id: p.id,
        label: p.label.trim() || `Person ${index + 1}`,
        location: p.location!,
      }));
      void executeSearch(origins, {
        category: urlState.category,
        mode: urlState.mode,
        objective: urlState.objective,
        ratingWeight: urlState.ratingWeight,
        limit: urlState.limit,
        openNow: urlState.openNow,
        priceLevels: urlState.priceLevels,
        minRating: urlState.minRating,
        cuisines: urlState.cuisines,
        meetTime: urlState.meetTime,
        excludeBuses: urlState.excludeBuses,
        transitRouting: urlState.transitRouting,
      });
    }
    // Runs once on mount to hydrate from a shared link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showMap = mapOrigins.length > 0 || (result?.venues.length ?? 0) > 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo" aria-hidden="true">
            <LogoMark />
          </span>
          <div>
            <h1 className="topbar__title">Meetup Finder</h1>
            <p className="topbar__tag">Meet in the spot that is fairest for everyone.</p>
          </div>
        </div>
        <div className="topbar__actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            aria-pressed={theme === "dark"}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <main className="layout">
        <aside className="panel">
          <section className="block">
            <h2 className="block__title">Who is meeting?</h2>
            <p className="block__hint">Add where each person is starting from.</p>
            <OriginsForm
              people={people}
              maxPeople={MAX_PEOPLE}
              geolocationSupported={geolocationSupported}
              favourites={favourites}
              onUpdate={updatePerson}
              onResolve={resolvePerson}
              onSelectPlace={selectPlace}
              onUseMyLocation={useMyLocation}
              onRemove={removePerson}
              onAdd={addPerson}
              onSaveFavourite={saveFavouriteFromPerson}
              onInsertFavourite={insertFavourite}
              onDeleteFavourite={deleteFavourite}
            />
          </section>

          <section className="block">
            <h2 className="block__title">What for?</h2>
            <CategoryPicker value={category} onChange={setCategory} />
          </section>

          <section className="block">
            <h2 className="block__title">How are they travelling?</h2>
            <ModePicker value={mode} onChange={setMode} />
          </section>

          <section className="block">
            <button
              type="button"
              className="disclosure"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? "Hide" : "Show"} advanced options
            </button>
            {showAdvanced ? (
              <AdvancedControls
                objective={objective}
                onObjective={setObjective}
                ratingWeight={ratingWeight}
                onRatingWeight={setRatingWeight}
                limit={limit}
                onLimit={setLimit}
                openNow={openNow}
                onOpenNow={setOpenNow}
                priceLevels={priceLevels}
                onPriceLevels={setPriceLevels}
                minRating={minRating}
                onMinRating={setMinRating}
                cuisines={cuisines}
                onCuisines={setCuisines}
                category={category}
                meetTime={meetTime}
                onMeetTime={setMeetTime}
                showTransit={mode === "transit"}
                excludeBuses={excludeBuses}
                onExcludeBuses={setExcludeBuses}
                transitRouting={transitRouting}
                onTransitRouting={setTransitRouting}
              />
            ) : null}
          </section>

          <button
            type="button"
            className="btn btn--primary btn--search"
            onClick={handleSearch}
            disabled={!canSearch}
          >
            {loading ? "Finding the fairest spot…" : "Find meeting spots"}
          </button>
          {error ? (
            <div className={"form-error form-error--" + error.kind} role="alert">
              <strong className="form-error__title">
                {error.kind === "server"
                  ? "Something went wrong on our side"
                  : error.kind === "network"
                    ? "Could not reach the server"
                    : "Check your details"}
              </strong>
              <span className="form-error__detail">{error.message}</span>
              {error.kind !== "request" ? (
                <span className="form-error__hint">Please try again in a moment.</span>
              ) : null}
            </div>
          ) : null}
        </aside>

        <section className="content">
          {showMap ? (
            <MapView
              origins={mapOrigins}
              venues={result?.venues ?? []}
              seed={result?.seed}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : null}

          {loading ? (
            <LoadingResults />
          ) : result ? (
            <ResultsList
              result={result}
              selectedId={selectedId}
              onSelect={setSelectedId}
              shareUrl={shareUrl}
            />
          ) : (
            <div className="state state--empty">
              <span className="state__art" aria-hidden="true">
                <MeetIcon />
              </span>
              <h2>Find the fairest place to meet</h2>
              <p>
                Add where everyone is starting from and pick what you fancy. Meetup Finder ranks
                real venues by the actual travel time for each person, blended with how good the
                place is.
              </p>
              <ol className="state__steps">
                <li className="state__step">
                  <span className="state__step-num">1</span>
                  <span className="state__step-text">Add two or more starting points</span>
                </li>
                <li className="state__step">
                  <span className="state__step-num">2</span>
                  <span className="state__step-text">Choose a category and how you travel</span>
                </li>
                <li className="state__step">
                  <span className="state__step-num">3</span>
                  <span className="state__step-text">Compare spots ranked by fair travel time</span>
                </li>
              </ol>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
