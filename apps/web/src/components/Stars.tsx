import { formatRating, formatRatingCount } from "../format";

interface StarsProps {
  rating?: number;
  count?: number;
}

export function Stars({ rating, count }: StarsProps) {
  const clamped = Math.max(0, Math.min(5, rating ?? 0));
  const widthPct = (clamped / 5) * 100;
  const countLabel = formatRatingCount(count);

  return (
    <span className="stars" title={`${formatRating(rating)} out of 5`}>
      <span className="stars__track" aria-hidden="true">
        <span className="stars__fill" style={{ width: `${widthPct}%` }}>
          ★★★★★
        </span>
        <span className="stars__empty">★★★★★</span>
      </span>
      <span className="stars__value">{formatRating(rating)}</span>
      {countLabel ? <span className="stars__count">({countLabel})</span> : null}
    </span>
  );
}
