import type { Objective, TransitRoutingPreference, VenueCategory } from "@meetup/core";

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

const PRICE_LEVELS: Array<{ value: number; label: string; hint: string }> = [
  { value: 1, label: "£", hint: "Inexpensive" },
  { value: 2, label: "££", hint: "Moderate" },
  { value: 3, label: "£££", hint: "Expensive" },
  { value: 4, label: "££££", hint: "Very expensive" },
];

const MIN_RATINGS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Any rating" },
  { value: 3, label: "3.0+" },
  { value: 3.5, label: "3.5+" },
  { value: 4, label: "4.0+" },
  { value: 4.5, label: "4.5+" },
];

/** Common cuisine hints offered for food searches. */
const CUISINES: string[] = [
  "Indian",
  "Italian",
  "Chinese",
  "Thai",
  "Japanese",
  "Mexican",
  "American",
  "Mediterranean",
  "Korean",
  "Vietnamese",
  "Turkish",
  "French",
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
  priceLevels: number[];
  onPriceLevels: (value: number[]) => void;
  minRating: number;
  onMinRating: (value: number) => void;
  cuisines: string[];
  onCuisines: (value: string[]) => void;
  category: VenueCategory;
  meetTime: string;
  onMeetTime: (value: string) => void;
  /** Transit only controls are shown when the travel mode is transit. */
  showTransit: boolean;
  excludeBuses: boolean;
  onExcludeBuses: (value: boolean) => void;
  transitRouting: TransitRoutingChoice;
  onTransitRouting: (value: TransitRoutingChoice) => void;
}

const MEAL_CATEGORIES: VenueCategory[] = ["lunch", "dinner"];

export function AdvancedControls(props: AdvancedControlsProps) {
  const travelPct = Math.round((1 - props.ratingWeight) * 100);
  const ratingPct = Math.round(props.ratingWeight * 100);

  function togglePrice(level: number) {
    const next = props.priceLevels.includes(level)
      ? props.priceLevels.filter((value) => value !== level)
      : [...props.priceLevels, level].sort();
    props.onPriceLevels(next);
  }

  function toggleCuisine(cuisine: string) {
    const next = props.cuisines.includes(cuisine)
      ? props.cuisines.filter((value) => value !== cuisine)
      : [...props.cuisines, cuisine];
    props.onCuisines(next);
  }

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

      <div className="field">
        <span className="field__label">
          Price <span className="muted">any when none selected</span>
        </span>
        <div className="chips" role="group" aria-label="Price level">
          {PRICE_LEVELS.map((price) => {
            const active = props.priceLevels.includes(price.value);
            return (
              <button
                type="button"
                key={price.value}
                className={"chip" + (active ? " is-active" : "")}
                aria-pressed={active}
                title={price.hint}
                onClick={() => togglePrice(price.value)}
              >
                {price.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="field field--inline">
        <span className="field__label">Minimum rating</span>
        <select
          value={props.minRating}
          onChange={(event) => props.onMinRating(Number(event.target.value))}
        >
          {MIN_RATINGS.map((rating) => (
            <option key={rating.value} value={rating.value}>
              {rating.label}
            </option>
          ))}
        </select>
      </label>

      {MEAL_CATEGORIES.includes(props.category) ? (
        <div className="field">
          <span className="field__label">
            Cuisine <span className="muted">pick any to narrow the search</span>
          </span>
          <div className="chips" role="group" aria-label="Cuisine">
            {CUISINES.map((cuisine) => {
              const active = props.cuisines.includes(cuisine);
              return (
                <button
                  type="button"
                  key={cuisine}
                  className={"chip" + (active ? " is-active" : "")}
                  aria-pressed={active}
                  onClick={() => toggleCuisine(cuisine)}
                >
                  {cuisine}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {MEAL_CATEGORIES.includes(props.category) ? (
        <label className="field field--inline">
          <span className="field__label">
            Meet time{" "}
            <span className="muted">favour places serving {props.category} then</span>
          </span>
          <input
            type="time"
            value={props.meetTime}
            onChange={(event) => props.onMeetTime(event.target.value)}
            aria-label={`Planned ${props.category} time`}
          />
        </label>
      ) : null}

      {props.showTransit ? (
        <div className="field">
          <span className="field__label">Public transport options</span>
          <div className="subfields">
            <div className="subfield">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={props.excludeBuses}
                  onChange={(event) => props.onExcludeBuses(event.target.checked)}
                />
                <span>Exclude buses</span>
              </label>
              <p className="field__hint">Plan with trains and the tube only, skipping bus legs.</p>
            </div>
            <div className="subfield">
              <label className="field field--inline">
                <span className="field__label field__label--soft">Routing</span>
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
              <p className="field__hint">
                How journeys are planned: fewer changes, or less time walking.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
