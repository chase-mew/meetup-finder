import { objectiveCost, maxSeconds, totalSeconds, varianceSeconds } from "./objectives";
import { DEFAULT_RATING_PRIOR, bayesianRating, normalizeRating } from "./rating";
import type {
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
  objectiveCostSeconds: number;
  totalSeconds: number;
  maxSeconds: number;
  varianceSeconds: number;
  unreachableCount: number;
  bayesianRating: number;
  normalizedRating: number;
}

function normalizeWeights(weights: ScoreWeights): ScoreWeights {
  const sum = weights.travel + weights.rating;
  if (sum <= 0) {
    return DEFAULT_WEIGHTS;
  }
  return { travel: weights.travel / sum, rating: weights.rating / sum };
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
      objectiveCostSeconds: durations.length > 0 ? objectiveCost(options.objective, durations) : 0,
      totalSeconds: totalSeconds(durations),
      maxSeconds: maxSeconds(durations),
      varianceSeconds: varianceSeconds(durations),
      unreachableCount,
      bayesianRating: bayes,
      normalizedRating: normalizeRating(bayes, ratingRange),
    };
  });

  const reachableCosts = intermediates
    .filter((entry) => entry.reachable)
    .map((entry) => entry.objectiveCostSeconds);
  const minCost = reachableCosts.length > 0 ? Math.min(...reachableCosts) : 0;
  const maxCost = reachableCosts.length > 0 ? Math.max(...reachableCosts) : 0;
  const costSpan = maxCost - minCost;

  const scored: ScoredCandidate[] = intermediates.map((entry) => {
    const normalizedTravel = entry.reachable
      ? costSpan > 0
        ? (entry.objectiveCostSeconds - minCost) / costSpan
        : 0
      : 1;

    const reachableScore =
      weights.travel * normalizedTravel + weights.rating * (1 - entry.normalizedRating);

    // Unreachable venues always sort after reachable ones, worst first.
    const finalScore = entry.reachable ? reachableScore : 1 + entry.unreachableCount;

    return {
      id: entry.candidate.id,
      reachable: entry.reachable,
      objectiveCostSeconds: entry.objectiveCostSeconds,
      totalSeconds: entry.totalSeconds,
      maxSeconds: entry.maxSeconds,
      varianceSeconds: entry.varianceSeconds,
      normalizedTravel,
      bayesianRating: entry.bayesianRating,
      normalizedRating: entry.normalizedRating,
      finalScore,
    };
  });

  return scored.sort((a, b) => a.finalScore - b.finalScore);
}
