import { useEffect, useState } from "react";

// The search runs an area matrix, several venue searches, and a venue matrix.
// We have no streaming progress from the API yet, so we surface a staged status
// that advances on a timer to make the wait feel meaningful rather than opaque.
const STAGES = [
  "Finding the meeting area",
  "Searching venues nearby",
  "Ranking by travel time",
];

const STAGE_INTERVAL_MS = 2200;
const SKELETON_COUNT = 4;

export function LoadingResults() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStage((current) => Math.min(current + 1, STAGES.length - 1));
    }, STAGE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="results" aria-busy="true" aria-live="polite">
      <ol className="stages">
        {STAGES.map((label, index) => {
          const state =
            index < stage ? "is-done" : index === stage ? "is-active" : "is-pending";
          return (
            <li key={label} className={"stages__item " + state}>
              <span className="stages__dot" aria-hidden="true" />
              <span className="stages__label">{label}</span>
            </li>
          );
        })}
      </ol>

      <div className="results__list">
        {Array.from({ length: SKELETON_COUNT }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <article className="venue venue--skeleton" aria-hidden="true">
      <div className="venue__photo skeleton" />
      <div className="venue__body">
        <div className="skeleton skeleton__line skeleton__line--title" />
        <div className="skeleton skeleton__line skeleton__line--meta" />
        <div className="skeleton skeleton__line skeleton__line--address" />
        <div className="skeleton__bars">
          <div className="skeleton skeleton__line skeleton__line--bar" />
          <div className="skeleton skeleton__line skeleton__line--bar" />
        </div>
      </div>
    </article>
  );
}
