import type {
  Objective,
  SearchRequestBody,
  SearchResponseBody,
  TravelMode,
  VenueCategory,
} from "@meetup/core";
import { useMemo, useState } from "react";
import { geocode, search } from "./api";
import { AdvancedControls } from "./components/AdvancedControls";
import { CategoryPicker } from "./components/CategoryPicker";
import { MapView, type MapOrigin } from "./components/MapView";
import { ModePicker } from "./components/ModePicker";
import { OriginsForm } from "./components/OriginsForm";
import { ResultsList } from "./components/ResultsList";
import type { Person } from "./types";

const MAX_PEOPLE = 10;

function newPerson(): Person {
  return {
    id: crypto.randomUUID(),
    label: "",
    address: "",
    status: "idle",
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

export function App() {
  const [people, setPeople] = useState<Person[]>(() => [newPerson(), newPerson()]);
  const [category, setCategory] = useState<VenueCategory>("cafe");
  const [mode, setMode] = useState<TravelMode>("transit");
  const [objective, setObjective] = useState<Objective>("best");
  const [ratingWeight, setRatingWeight] = useState(0.3);
  const [limit, setLimit] = useState(5);
  const [openNow, setOpenNow] = useState(false);
  const [meetTime, setMeetTime] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResponseBody | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function updatePerson(id: string, patch: Partial<Person>) {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function addPerson() {
    setPeople((prev) => (prev.length >= MAX_PEOPLE ? prev : [...prev, newPerson()]));
  }

  function removePerson(id: string) {
    setPeople((prev) => (prev.length <= 2 ? prev : prev.filter((p) => p.id !== id)));
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

    if (origins.length < 2) {
      setError("Enter at least two valid locations to find a meeting spot.");
      return;
    }

    const usesMeetTime = category === "lunch" || category === "dinner";
    const body: SearchRequestBody = {
      origins,
      category,
      mode,
      objective,
      travelWeight: Number((1 - ratingWeight).toFixed(2)),
      ratingWeight: Number(ratingWeight.toFixed(2)),
      limit,
      openNow,
      meetTime: usesMeetTime && meetTime ? meetTime : undefined,
    };

    setLoading(true);
    try {
      const response = await search(body);
      setResult(response);
      setSelectedId(response.venues[0]?.id ?? null);
    } catch (searchError) {
      const message = searchError instanceof Error ? searchError.message : "Search failed";
      setError(message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  const showMap = mapOrigins.length > 0 || (result?.venues.length ?? 0) > 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo">◎</span>
          <div>
            <h1 className="topbar__title">Meetup Finder</h1>
            <p className="topbar__tag">Meet in the spot that is fairest for everyone.</p>
          </div>
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
              onUpdate={updatePerson}
              onResolve={resolvePerson}
              onRemove={removePerson}
              onAdd={addPerson}
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
                category={category}
                meetTime={meetTime}
                onMeetTime={setMeetTime}
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
          {error ? <p className="form-error">{error}</p> : null}
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
            <div className="state state--loading">Calculating travel times…</div>
          ) : result ? (
            <ResultsList result={result} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <div className="state state--empty">
              <h2>Find the fairest place to meet</h2>
              <p>
                Add two or more starting points, pick a category, and Meetup Finder ranks real
                venues by the actual travel time for everyone, blended with how good the place is.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
