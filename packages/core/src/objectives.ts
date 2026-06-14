import type { BaseObjective } from "./types";

/** Sum of all travel times. */
export function totalSeconds(durations: number[]): number {
  let sum = 0;
  for (const d of durations) {
    sum += d;
  }
  return sum;
}

/** Worst (largest) single travel time. */
export function maxSeconds(durations: number[]): number {
  let max = 0;
  for (const d of durations) {
    if (d > max) {
      max = d;
    }
  }
  return max;
}

/** Mean travel time. */
export function meanSeconds(durations: number[]): number {
  if (durations.length === 0) {
    return 0;
  }
  return totalSeconds(durations) / durations.length;
}

/** Population variance of travel times, in seconds squared. */
export function varianceSeconds(durations: number[]): number {
  if (durations.length === 0) {
    return 0;
  }
  const mean = meanSeconds(durations);
  let acc = 0;
  for (const d of durations) {
    const diff = d - mean;
    acc += diff * diff;
  }
  return acc / durations.length;
}

/**
 * Compute the cost for a set of durations under the chosen objective.
 * Lower is always better. The variance objective uses the standard
 * deviation so the cost stays in seconds and is comparable in scale.
 */
export function objectiveCost(objective: BaseObjective, durations: number[]): number {
  switch (objective) {
    case "min_total":
      return totalSeconds(durations);
    case "min_max":
      return maxSeconds(durations);
    case "min_variance":
      return Math.sqrt(varianceSeconds(durations));
    default: {
      const exhaustive: never = objective;
      throw new Error(`Unknown objective: ${String(exhaustive)}`);
    }
  }
}

/**
 * The base objectives blended into the default "best" score, in a fixed order.
 * Shared so the area finder and the venue scorer agree on what "best" means.
 */
export const BEST_OBJECTIVES: readonly BaseObjective[] = [
  "min_total",
  "min_max",
  "min_variance",
];

/**
 * Relative weights used to blend the base objectives into "best", aligned by
 * index with {@link BEST_OBJECTIVES}.
 *
 * The two fairness measures, the worst single trip (`min_max`) and how even the
 * trips are (`min_variance`), carry the decision together, while raw efficiency
 * (`min_total`) is demoted to a light tie-breaker. Total travel on its own is
 * indifferent to who does the travelling, so weighting it equally let a venue
 * next to whoever sits on a fast line win even when one person did almost all
 * the journey. Leaning on the fairness measures keeps the result between people
 * without "levelling down" to somewhere slower for everyone, since `min_max`
 * never prefers making the worst trip longer just to even things out.
 */
export const BEST_OBJECTIVE_WEIGHTS: readonly number[] = [0.2, 0.4, 0.4];

/**
 * Blend per-objective normalised costs (each 0 best .. 1 worst, aligned with
 * {@link BEST_OBJECTIVES}) into a single "best" cost using
 * {@link BEST_OBJECTIVE_WEIGHTS}. The weights are normalised here, so they need
 * not sum to 1 and a caller can never bias the result by their absolute scale.
 */
export function blendBestCost(normalizedComponents: number[]): number {
  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < BEST_OBJECTIVES.length; i += 1) {
    const weight = BEST_OBJECTIVE_WEIGHTS[i] ?? 0;
    weightedSum += weight * (normalizedComponents[i] ?? 0);
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedSum / weightTotal : 0;
}
