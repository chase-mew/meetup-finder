import type { ResultVenue } from "@meetup/core";
import { photoUrl } from "../api";
import { formatDuration, formatPriceLevel } from "../format";
import { Stars } from "./Stars";
import { TravelBars } from "./TravelBars";

interface VenueCardProps {
  venue: ResultVenue;
  rank: number;
  scaleSeconds: number;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function VenueCard({ venue, rank, scaleSeconds, selected, onSelect }: VenueCardProps) {
  const price = formatPriceLevel(venue.priceLevel);

  return (
    <article
      className={"venue" + (selected ? " is-selected" : "")}
      onClick={() => onSelect(venue.id)}
    >
      {venue.photoRef ? (
        <div className="venue__photo">
          <img src={photoUrl(venue.photoRef, 600)} alt={venue.name} loading="lazy" />
          <span className="venue__rank">{rank}</span>
        </div>
      ) : (
        <div className="venue__photo venue__photo--empty">
          <span className="venue__rank">{rank}</span>
        </div>
      )}

      <div className="venue__body">
        <header className="venue__header">
          <h3 className="venue__name">{venue.name}</h3>
          {venue.openNow !== undefined ? (
            <span className={"badge " + (venue.openNow ? "badge--open" : "badge--closed")}>
              {venue.openNow ? "Open" : "Closed"}
            </span>
          ) : null}
        </header>

        <div className="venue__meta">
          <Stars rating={venue.rating} count={venue.ratingCount} />
          {price ? <span className="venue__price">{price}</span> : null}
          {venue.categoryLabel ? (
            <span className="venue__type">{venue.categoryLabel}</span>
          ) : null}
        </div>

        {venue.address ? <p className="venue__address">{venue.address}</p> : null}

        <div className="venue__summary">
          <span>
            Longest trip <strong>{formatDuration(venue.maxSeconds)}</strong>
          </span>
          <span className="muted">·</span>
          <span>
            Total <strong>{formatDuration(venue.totalSeconds)}</strong>
          </span>
        </div>

        {!venue.reachable ? (
          <p className="venue__warning">Not everyone can reach this by the chosen mode.</p>
        ) : null}

        <TravelBars
          legs={venue.legs}
          scaleSeconds={scaleSeconds}
          highlightMaxSeconds={venue.maxSeconds}
        />

        <div className="venue__actions">
          {venue.googleMapsUri ? (
            <a
              className="btn btn--small"
              href={venue.googleMapsUri}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              Directions
            </a>
          ) : null}
          {venue.websiteUri ? (
            <a
              className="btn btn--small btn--ghost"
              href={venue.websiteUri}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              Website
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
