import type { Objective, SearchResponseBody, TravelMode } from "@meetup/core";
import { VenueCard } from "./VenueCard";

const OBJECTIVE_LABELS: Record<Objective, string> = {
  best: "best overall",
  min_max: "fairest",
  min_total: "most efficient",
  min_variance: "most even",
};

const MODE_LABELS: Record<TravelMode, string> = {
  transit: "public transport",
  walking: "walking",
  cycling: "cycling",
  driving: "driving",
};

interface ResultsListProps {
  result: SearchResponseBody;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ResultsList({ result, selectedId, onSelect }: ResultsListProps) {
  const scaleSeconds = result.venues.reduce((max, venue) => {
    for (const leg of venue.legs) {
      if (leg.durationSeconds !== null && leg.durationSeconds > max) {
        max = leg.durationSeconds;
      }
    }
    return max;
  }, 0);

  if (result.venues.length === 0) {
    return (
      <div className="results">
        <p className="empty">
          No venues found near the meeting point. Try a wider category or a larger search radius.
        </p>
      </div>
    );
  }

  return (
    <div className="results">
      <div className="results__summary">
        Showing the <strong>{OBJECTIVE_LABELS[result.objective]}</strong> spots by{" "}
        {MODE_LABELS[result.mode]} for {result.origins.length} people.
      </div>
      <div className="results__list">
        {result.venues.map((venue, index) => (
          <VenueCard
            key={venue.id}
            venue={venue}
            rank={index + 1}
            scaleSeconds={scaleSeconds}
            selected={venue.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
