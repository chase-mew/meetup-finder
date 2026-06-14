import type { Objective, TransitRoutingPreference } from "@meetup/core";

const OBJECTIVES: Array<{ value: Objective; label: string; hint: string }> = [
  { value: "best", label: "Best", hint: "Balances all three goals below" },
  { value: "min_max", label: "Fairest", hint: "Nobody travels too far" },
  { value: "min_total", label: "Most efficient", hint: "Lowest total travel time" },
  { value: "min_variance", label: "Most even", hint: "Everyone travels about the same" },
];

/** Sentinel for "no transit routing preference" in the select control. */
export type TransitRoutingChoice = TransitRoutingPreference | "any";

const TRANSIT_ROUTING: Array<{ value: TransitRoutingChoice; label: string }> = [
  { value: "any", label: "No preference" },
  { value: "fewer_transfers", label: "Fewer transfers" },
  { value: "less_walking", label: "Less walking" },
];

interface AdvancedControlsProps {
  objective: Objective;
  onObjective: (value: Objective) => void;
  ratingWeight: number;
  onRatingWeight: (value: number) => void;
  limit: number;
  onLimit: (value: number) => void;
  openNow: boolean;
  onOpenNow: (value: boolean) => void;
  /** Transit only controls are shown when the travel mode is transit. */
  showTransit: boolean;
  excludeBuses: boolean;
  onExcludeBuses: (value: boolean) => void;
  transitRouting: TransitRoutingChoice;
  onTransitRouting: (value: TransitRoutingChoice) => void;
}

export function AdvancedControls(props: AdvancedControlsProps) {
  const travelPct = Math.round((1 - props.ratingWeight) * 100);
  const ratingPct = Math.round(props.ratingWeight * 100);

  return (
    <div className="advanced">
      <div className="field">
        <span className="field__label">Fairness goal</span>
        <div className="segmented segmented--stack" role="group" aria-label="Fairness goal">
          {OBJECTIVES.map((objective) => (
            <button
              type="button"
              key={objective.value}
              className={
                "segmented__item" + (props.objective === objective.value ? " is-active" : "")
              }
              aria-pressed={props.objective === objective.value}
              onClick={() => props.onObjective(objective.value)}
            >
              <span className="segmented__title">{objective.label}</span>
              <span className="segmented__hint">{objective.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field__label">
          Balance <span className="muted">travel {travelPct}% · rating {ratingPct}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={ratingPct}
          onChange={(event) => props.onRatingWeight(Number(event.target.value) / 100)}
          aria-label="How much venue rating matters"
        />
        <div className="range-ends">
          <span>Travel time</span>
          <span>Venue rating</span>
        </div>
      </div>

      <div className="field field--row">
        <label className="field field--inline">
          <span className="field__label">Results</span>
          <select
            value={props.limit}
            onChange={(event) => props.onLimit(Number(event.target.value))}
          >
            {[3, 5, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.openNow}
            onChange={(event) => props.onOpenNow(event.target.checked)}
          />
          <span>Open now only</span>
        </label>
      </div>

      {props.showTransit ? (
        <div className="field">
          <span className="field__label">Transit preferences</span>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={props.excludeBuses}
              onChange={(event) => props.onExcludeBuses(event.target.checked)}
            />
            <span>Exclude buses</span>
          </label>
          <label className="field field--inline">
            <span className="field__label">Routing</span>
            <select
              value={props.transitRouting}
              onChange={(event) =>
                props.onTransitRouting(event.target.value as TransitRoutingChoice)
              }
            >
              {TRANSIT_ROUTING.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}
