import { useEffect, useId, useRef, useState } from "react";
import { type AutocompletePrediction, autocomplete } from "../api";
import type { Person } from "../types";
import { LocateIcon } from "./icons";

interface OriginsFormProps {
  people: Person[];
  maxPeople: number;
  geolocationSupported: boolean;
  onUpdate: (id: string, patch: Partial<Person>) => void;
  onResolve: (id: string) => void;
  onSelectPlace: (id: string, prediction: AutocompletePrediction) => void;
  onUseMyLocation: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}

const DEBOUNCE_MS = 250;

function StatusLine({ person }: { person: Person }) {
  if (person.status === "locating") {
    return <span className="origin__status origin__status--loading">Getting your location…</span>;
  }
  if (person.status === "loading") {
    return <span className="origin__status origin__status--loading">Finding location…</span>;
  }
  if (person.status === "error") {
    return (
      <span className="origin__status origin__status--error">
        {person.error ?? "Could not find that address"}
      </span>
    );
  }
  if (person.status === "ok" && person.resolvedAddress) {
    return (
      <span className="origin__status origin__status--ok" title={person.resolvedAddress}>
        {person.resolvedAddress}
      </span>
    );
  }
  return null;
}

interface OriginRowProps {
  person: Person;
  index: number;
  canRemove: boolean;
  geolocationSupported: boolean;
  onUpdate: (id: string, patch: Partial<Person>) => void;
  onResolve: (id: string) => void;
  onSelectPlace: (id: string, prediction: AutocompletePrediction) => void;
  onUseMyLocation: (id: string) => void;
  onRemove: (id: string) => void;
}

function OriginRow({
  person,
  index,
  canRemove,
  geolocationSupported,
  onUpdate,
  onResolve,
  onSelectPlace,
  onUseMyLocation,
  onRemove,
}: OriginRowProps) {
  const [suggestions, setSuggestions] = useState<AutocompletePrediction[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Set when the user picks a suggestion so the follow up blur skips geocoding.
  const skipNextResolve = useRef(false);
  // The query that produced the latest suggestions, so we can avoid refetching it.
  const lastFetched = useRef<string | null>(null);

  const listboxId = useId();
  const query = person.address.trim();

  useEffect(() => {
    if (!open || query.length < 2 || query === lastFetched.current) {
      return;
    }
    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      try {
        const results = await autocomplete(query, controller.signal);
        lastFetched.current = query;
        setSuggestions(results);
        setActiveIndex(-1);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSuggestions([]);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [query, open]);

  function close() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function choose(prediction: AutocompletePrediction) {
    skipNextResolve.current = true;
    lastFetched.current = prediction.description.trim();
    onSelectPlace(person.id, prediction);
    setSuggestions([]);
    close();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      if (suggestions.length === 0) {
        return;
      }
      event.preventDefault();
      setOpen(true);
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      if (suggestions.length === 0) {
        return;
      }
      event.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
      return;
    }
    if (event.key === "Enter") {
      if (open && activeIndex >= 0 && suggestions[activeIndex]) {
        event.preventDefault();
        choose(suggestions[activeIndex]!);
        return;
      }
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        close();
      }
    }
  }

  const showList = open && suggestions.length > 0;

  return (
    <div className="origin">
      <div className="origin__row">
        <span
          className={"origin__badge origin__badge--" + (person.status === "ok" ? "ok" : "idle")}
        >
          {String.fromCharCode(65 + index)}
        </span>
        <div className="origin__inputs">
          <input
            className="origin__name"
            type="text"
            value={person.label}
            placeholder="Name (optional)"
            onChange={(event) => onUpdate(person.id, { label: event.target.value })}
          />
          <div className="origin__address-wrap">
            <input
              className="origin__address"
              type="text"
              value={person.address}
              placeholder="Address, station or postcode"
              role="combobox"
              aria-expanded={showList}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={
                showList && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
              }
              autoComplete="off"
              onChange={(event) => {
                lastFetched.current = null;
                skipNextResolve.current = false;
                setOpen(true);
                onUpdate(person.id, { address: event.target.value, status: "idle" });
              }}
              onFocus={() => {
                if (suggestions.length > 0) {
                  setOpen(true);
                }
              }}
              onBlur={() => {
                close();
                if (skipNextResolve.current) {
                  skipNextResolve.current = false;
                  return;
                }
                onResolve(person.id);
              }}
              onKeyDown={handleKeyDown}
            />
            {showList ? (
              <ul className="origin__suggestions" id={listboxId} role="listbox">
                {suggestions.map((prediction, optionIndex) => (
                  <li
                    key={prediction.placeId}
                    id={`${listboxId}-option-${optionIndex}`}
                    role="option"
                    aria-selected={optionIndex === activeIndex}
                    className={
                      "origin__suggestion" +
                      (optionIndex === activeIndex ? " origin__suggestion--active" : "")
                    }
                    onMouseDown={(event) => {
                      // Keep focus on the input so onBlur fires after selection.
                      event.preventDefault();
                      choose(prediction);
                    }}
                    onMouseEnter={() => setActiveIndex(optionIndex)}
                  >
                    <span className="origin__suggestion-main">
                      {prediction.mainText ?? prediction.description}
                    </span>
                    {prediction.secondaryText ? (
                      <span className="origin__suggestion-secondary">
                        {prediction.secondaryText}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {geolocationSupported ? (
            <button
              type="button"
              className="origin__locate"
              onClick={() => onUseMyLocation(person.id)}
              disabled={person.status === "locating"}
            >
              <LocateIcon />
              {person.status === "locating" ? "Locating…" : "Use my location"}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="origin__remove"
          aria-label={`Remove person ${index + 1}`}
          disabled={!canRemove}
          onClick={() => onRemove(person.id)}
        >
          ×
        </button>
      </div>
      <StatusLine person={person} />
    </div>
  );
}

export function OriginsForm({
  people,
  maxPeople,
  geolocationSupported,
  onUpdate,
  onResolve,
  onSelectPlace,
  onUseMyLocation,
  onRemove,
  onAdd,
}: OriginsFormProps) {
  return (
    <div className="origins">
      {people.map((person, index) => (
        <OriginRow
          key={person.id}
          person={person}
          index={index}
          canRemove={people.length > 2}
          geolocationSupported={geolocationSupported}
          onUpdate={onUpdate}
          onResolve={onResolve}
          onSelectPlace={onSelectPlace}
          onUseMyLocation={onUseMyLocation}
          onRemove={onRemove}
        />
      ))}

      <button
        type="button"
        className="btn btn--ghost btn--add"
        onClick={onAdd}
        disabled={people.length >= maxPeople}
      >
        + Add another person
      </button>
    </div>
  );
}
