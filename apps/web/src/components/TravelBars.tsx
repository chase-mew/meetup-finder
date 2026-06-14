import type { ResultLeg } from "@meetup/core";
import { formatDuration } from "../format";

interface TravelBarsProps {
  legs: ResultLeg[];
  /** Largest duration across all shown venues, for comparable bar widths. */
  scaleSeconds: number;
  /** The worst leg for this venue is highlighted. */
  highlightMaxSeconds?: number;
}

export function TravelBars({ legs, scaleSeconds, highlightMaxSeconds }: TravelBarsProps) {
  const scale = scaleSeconds > 0 ? scaleSeconds : 1;

  return (
    <ul className="travel-bars">
      {legs.map((leg) => {
        const reachable = leg.durationSeconds !== null;
        const widthPct = reachable
          ? Math.max(4, Math.min(100, (leg.durationSeconds! / scale) * 100))
          : 100;
        const isWorst =
          reachable &&
          highlightMaxSeconds !== undefined &&
          leg.durationSeconds === highlightMaxSeconds;

        return (
          <li className="travel-bars__row" key={leg.originId}>
            <span className="travel-bars__label" title={leg.originLabel ?? leg.originId}>
              {leg.originLabel ?? leg.originId}
            </span>
            <span className="travel-bars__track">
              <span
                className={
                  "travel-bars__fill" +
                  (reachable ? "" : " travel-bars__fill--none") +
                  (isWorst ? " travel-bars__fill--worst" : "")
                }
                style={{ width: `${widthPct}%` }}
              />
            </span>
            <span className="travel-bars__time">{formatDuration(leg.durationSeconds)}</span>
          </li>
        );
      })}
    </ul>
  );
}
