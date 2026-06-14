import type { Person } from "../types";

interface OriginsFormProps {
  people: Person[];
  maxPeople: number;
  geolocationSupported: boolean;
  onUpdate: (id: string, patch: Partial<Person>) => void;
  onResolve: (id: string) => void;
  onUseMyLocation: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}

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

export function OriginsForm({
  people,
  maxPeople,
  geolocationSupported,
  onUpdate,
  onResolve,
  onUseMyLocation,
  onRemove,
  onAdd,
}: OriginsFormProps) {
  return (
    <div className="origins">
      {people.map((person, index) => (
        <div className="origin" key={person.id}>
          <div className="origin__row">
            <span className={"origin__badge origin__badge--" + (person.status === "ok" ? "ok" : "idle")}>
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
              <input
                className="origin__address"
                type="text"
                value={person.address}
                placeholder="Address, station or postcode"
                onChange={(event) =>
                  onUpdate(person.id, { address: event.target.value, status: "idle" })
                }
                onBlur={() => onResolve(person.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
              {geolocationSupported ? (
                <button
                  type="button"
                  className="origin__locate"
                  onClick={() => onUseMyLocation(person.id)}
                  disabled={person.status === "locating"}
                >
                  <span aria-hidden="true">◎</span>
                  {person.status === "locating" ? "Locating…" : "Use my location"}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="origin__remove"
              aria-label={`Remove person ${index + 1}`}
              disabled={people.length <= 2}
              onClick={() => onRemove(person.id)}
            >
              ×
            </button>
          </div>
          <StatusLine person={person} />
        </div>
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
