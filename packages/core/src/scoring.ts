import {
  BEST_OBJECTIVES,
  blendBestCost,
  maxSeconds,
  objectiveCost,
  totalSeconds,
  varianceSeconds,
} from "./objectives";
import { DEFAULT_RATING_PRIOR, bayesianRating, normalizeRating } from "./rating";
import type {
  BaseObjective,
  Objective,
  ScoreOptions,
  ScoreWeights,
  ScoredCandidate,
  ScoringCandidate,
} from "./types";

const DEFAULT_WEIGHTS: ScoreWeights = { travel: 0.7, rating: 0.3 };

interface Intermediate {
  candidate: ScoringCandidate;
  reachable: boolean;
  durations: number[];
  totalSeconds: number;
  maxSeconds: number;
  varianceSeconds: number;
  unreachableCount: number;
  bayesianRating: number;
  normalizedRating: number;
}

/** Normalise travel and rating weights so they sum to 1, falling back to defaults. */
export function normalizeWeights(weights: ScoreWeights): ScoreWeights {
  const sum = weights.travel + weights.rating;
  if (sum <= 0) {
    return DEFAULT_WEIGHTS;
  }
  return { travel: weights.travel / sum, rating: weights.rating / sum };
}

/** Normalise objective costs to 0..1 across the reachable candidates. */
function normalizeCosts(costs: number[], reachable: boolean[]): number[] {
  const reachableCosts = costs.filter((_, i) => reachable[i]);
  if (reachableCosts.length === 0) {
    return costs.map(() => 1);
  }
  const min = Math.min(...reachableCosts);
  const max = Math.max(...reachableCosts);
  const span = max - min;
  return costs.map((cost, i) => (reachable[i] ? (span > 0 ? (cost - min) / span : 0) : 1));
}

function costsForObjective(objective: BaseObjective, items: Intermediate[]): number[] {
  return items.map((item) =>
    item.durations.length > 0 ? objectiveCost(objective, item.durations) : 0,
  );
}

/**
 * Per candidate travel score in 0..1 (0 best, 1 worst).
 *
 * For a single objective this is just that objective normalised across the set.
 * For "best" we normalise each of the base objectives independently and blend
 * them with {@link BEST_OBJECTIVE_WEIGHTS}, so efficiency, worst case fairness,
 * and evenness all count on the same scale regardless of their very different
 * raw magnitudes, with fairness weighted above raw efficiency.
 */
function normalizedTravelScores(
  objective: Objective,
  items: Intermediate[],
  reachable: boolean[],
): number[] {
  if (objective === "best") {
    const components = BEST_OBJECTIVES.map((base) =>
      normalizeCosts(costsForObjective(base, items), reachable),
    );
    return items.map((_, i) => blendBestCost(components.map((component) => component[i]!)));
  }
  return normalizeCosts(costsForObjective(objective, items), reachable);
}

/** A representative travel time in seconds for display. */
function headlineCostSeconds(objective: Objective, item: Intermediate): number {
  if (item.durations.length === 0) {
    return 0;
  }
  // "best" has no single seconds value, so report the worst trip as the headline.
  return objective === "best" ? item.maxSeconds : objectiveCost(objective, item.durations);
}

/**
 * Score and rank candidate venues for the group.
 *
 * Travel cost is normalised across the candidate set (so the comparison is
 * relative to the realistic options), while rating is mapped onto an absolute
 * 0..1 scale. Venues that cannot be reached by every person are always ranked
 * below those that can. The returned array is sorted best first.
 */
export function scoreVenues(
  candidates: ScoringCandidate[],
  options: ScoreOptions,
): ScoredCandidate[] {
  const weights = normalizeWeights(options.weights ?? DEFAULT_WEIGHTS);
  const prior = options.ratingPrior ?? DEFAULT_RATING_PRIOR;
  const ratingRange = options.ratingRange ?? { min: 1, max: 5 };

  const intermediates: Intermediate[] = candidates.map((candidate) => {
    const durations = candidate.durationsSeconds.filter(
      (d): d is number => d !== null && Number.isFinite(d),
    );
    const unreachableCount = candidate.durationsSeconds.length - durations.length;
    const reachable =
      candidate.durationsSeconds.length > 0 && unreachableCount === 0;

    const bayes = bayesianRating(candidate.rating, candidate.ratingCount, prior);

    return {
      candidate,
      reachable,
      durations,
      totalSeconds: totalSeconds(durations),
      maxSeconds: maxSeconds(durations),
      varianceSeconds: varianceSeconds(durations),
      unreachableCount,
      bayesianRating: bayes,
      normalizedRating: normalizeRating(bayes, ratingRange),
    };
  });

  const reachable = intermediates.map((entry) => entry.reachable);
  const normalizedTravel = normalizedTravelScores(options.objective, intermediates, reachable);

  const scored: ScoredCandidate[] = intermediates.map((entry, i) => {
    const reachableScore =
      weights.travel * normalizedTravel[i]! + weights.rating * (1 - entry.normalizedRating);

    // Unreachable venues always sort after reachable ones, worst first.
    const finalScore = entry.reachable ? reachableScore : 1 + entry.unreachableCount;

    return {
      id: entry.candidate.id,
      reachable: entry.reachable,
      objectiveCostSeconds: headlineCostSeconds(options.objective, entry),
      totalSeconds: entry.totalSeconds,
      maxSeconds: entry.maxSeconds,
      varianceSeconds: entry.varianceSeconds,
      normalizedTravel: normalizedTravel[i]!,
      bayesianRating: entry.bayesianRating,
      normalizedRating: entry.normalizedRating,
      finalScore,
    };
  });

  return scored.sort((a, b) => a.finalScore - b.finalScore);
}
