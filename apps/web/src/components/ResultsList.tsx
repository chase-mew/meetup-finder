import type { Objective, SearchResponseBody, TravelMode } from "@meetup/core";
import { useEffect, useState } from "react";
import { explainResultsGeography } from "../explain";
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
        <div className="notice notice--empty" role="status">
          <strong className="notice__title">No venues found near the meeting point</strong>
          <p className="notice__body">
            Try a different category, switch the travel mode, or widen the search area.
          </p>
        </div>
      </div>
    );
  }

  const labelById = new Map(
    result.origins.map((origin, index) => [origin.id, origin.label ?? `Person ${index + 1}`]),
  );
  const unreachableNames = result.unreachableOrigins
    .map((id) => labelById.get(id) ?? id)
    .filter((name): name is string => Boolean(name));

  const geography = explainResultsGeography(result);

  return (
    <div className="results">
      <div className="results__header">
        <div className="results__summary">
          Showing the <strong>{OBJECTIVE_LABELS[result.objective]}</strong> spots by{" "}
          {MODE_LABELS[result.mode]} for {result.origins.length} people.
        </div>
        {shareUrl ? <CopyLinkButton shareUrl={shareUrl} /> : null}
      </div>

      {geography ? (
        <div className="notice notice--info" role="note">
          <strong className="notice__title">{geography.headline}</strong>
          <p className="notice__body">{geography.detail}</p>
        </div>
      ) : null}

      {unreachableNames.length > 0 ? (
        <div className="notice notice--warning" role="alert">
          <strong className="notice__title">
            {unreachableNames.length === 1
              ? `${unreachableNames[0]} can't reach any of these spots`
              : `${unreachableNames.join(", ")} can't reach any of these spots`}{" "}
            by {MODE_LABELS[result.mode]}.
          </strong>
          <p className="notice__body">
            Try a different travel mode or widen the search area so everyone has a route.
          </p>
        </div>
      ) : null}
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
