import type { Objective } from "./types";

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
export function objectiveCost(objective: Objective, durations: number[]): number {
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
