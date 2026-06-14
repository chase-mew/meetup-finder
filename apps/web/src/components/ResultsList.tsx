import type { Objective, SearchResponseBody, TravelMode } from "@meetup/core";
import { useEffect, useState } from "react";
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
  shareUrl: string | null;
}

function CopyLinkButton({ shareUrl }: { shareUrl: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        window.prompt("Copy this link", shareUrl);
      }
      setCopied(true);
    } catch {
      window.prompt("Copy this link", shareUrl);
    }
  }

  return (
    <button type="button" className="btn btn--ghost results__share" onClick={handleCopy}>
      {copied ? "Link copied" : "Copy link"}
    </button>
  );
}

export function ResultsList({ result, selectedId, onSelect, shareUrl }: ResultsListProps) {
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
      <div className="results__header">
        <div className="results__summary">
          Showing the <strong>{OBJECTIVE_LABELS[result.objective]}</strong> spots by{" "}
          {MODE_LABELS[result.mode]} for {result.origins.length} people.
        </div>
        {shareUrl ? <CopyLinkButton shareUrl={shareUrl} /> : null}
      </div>
      <div className="results__list">
        {result.venues.map((venue, index) => (
          <VenueCard
            key={venue.id}
            venue={venue}
            rank={index + 1}
            scaleSeconds={scaleSeconds}
            objective={result.objective}
            weights={result.weights}
            selected={venue.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
