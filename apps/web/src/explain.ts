import type { Objective, ResultVenue, ScoreWeights } from "@meetup/core";
import { formatDuration } from "./format";

/** A plain language, honest explanation of why a venue ranks where it does. */
export interface VenueExplanation {
  /** One short sentence capturing the main reason this venue ranks here. */
  headline: string;
  /** A fuller sentence describing the travel and rating trade off. */
  detail: string;
  /** Share of this venue's strength that comes from travel, 0..1. */
  travelShare: number;
  /** Share of this venue's strength that comes from rating, 0..1. */
  ratingShare: number;
}

const OBJECTIVE_TRAVEL_PHRASE: Record<Objective, string> = {
  best: "the best balance of travel for the group",
  min_max: "the fairest worst trip among the options",
  min_total: "the lowest combined travel for the group",
  min_variance: "the most even trips across the group",
};

const OBJECTIVE_HEADLINE: Record<Objective, string> = {
  best: "Best balance for the group",
  min_max: "Fairest worst trip among the options",
  min_total: "Lowest combined travel for the group",
  min_variance: "Most even trips for the group",
};

/** Describe how this venue's travel compares with the others (lower is better). */
function travelStanding(normalizedTravel: number): string {
  if (normalizedTravel <= 0.2) {
    return "the shortest trips of all the options";
  }
  if (normalizedTravel <= 0.5) {
    return "shorter trips than most options";
  }
  if (normalizedTravel <= 0.8) {
    return "middling travel times";
  }
  return "longer trips than most options";
}

/** Describe how strong this venue's rating is (higher is better). */
function ratingStanding(normalizedRating: number): string {
  if (normalizedRating >= 0.8) {
    return "an excellent rating";
  }
  if (normalizedRating >= 0.6) {
    return "a strong rating";
  }
  if (normalizedRating >= 0.4) {
    return "a decent rating";
  }
  return "a modest rating";
}

/**
 * Split this venue's appeal into the part carried by travel and the part carried
 * by rating, so a small bar can show what is really driving the ranking.
 *
 * Each strength weighs the chosen weight by how good the venue is on that axis
 * (travel uses 1 - normalizedTravel since lower travel is better).
 */
function strengthShares(
  venue: Pick<ResultVenue, "normalizedTravel" | "normalizedRating">,
  weights: ScoreWeights,
): { travelShare: number; ratingShare: number } {
  const travelStrength = weights.travel * (1 - venue.normalizedTravel);
  const ratingStrength = weights.rating * venue.normalizedRating;
  const total = travelStrength + ratingStrength;
  if (total <= 0) {
    return { travelShare: weights.travel, ratingShare: weights.rating };
  }
  const travelShare = travelStrength / total;
  return { travelShare, ratingShare: 1 - travelShare };
}

/**
 * Build a concise, honest explanation for a venue from the scoring fields that
 * already travel with the response. The wording reflects the chosen objective
 * and the travel versus rating weights the user picked.
 */
export function explainVenue(
  venue: ResultVenue,
  objective: Objective,
  weights: ScoreWeights,
): VenueExplanation {
  const { travelShare, ratingShare } = strengthShares(venue, weights);

  if (!venue.reachable) {
    return {
      headline: "Not everyone can reach this one",
      detail: `At least one person has no route here, so it ranks below places everyone can get to. The worst trip is ${formatDuration(venue.maxSeconds)}.`,
      travelShare,
      ratingShare,
    };
  }

  let headline: string;
  if (venue.normalizedTravel <= 0.15) {
    headline = OBJECTIVE_HEADLINE[objective];
  } else if (ratingShare > travelShare) {
    headline = "Higher rated, slightly longer for most";
  } else {
    headline = "Quick for the group, and fairly rated";
  }

  const detail =
    `Ranked for ${OBJECTIVE_TRAVEL_PHRASE[objective]}. ` +
    `It offers ${travelStanding(venue.normalizedTravel)} with ${ratingStanding(venue.normalizedRating)}, ` +
    `with the worst trip at ${formatDuration(venue.maxSeconds)}.`;

  return { headline, detail, travelShare, ratingShare };
}
