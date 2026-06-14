import type { VenueCategory } from "./types";

/** One end of an opening period. Day is 0=Sunday..6=Saturday, matching Google. */
export interface OpeningHoursPoint {
  day: number;
  hour: number;
  minute: number;
}

/**
 * A single open/close span. A period with an `open` but no `close` means the
 * venue is open continuously from that point (Google's "always open" shape).
 */
export interface OpeningPeriod {
  open: OpeningHoursPoint;
  close?: OpeningHoursPoint;
}

/** A venue's weekly opening hours, as exposed by Google's `regularOpeningHours`. */
export interface RegularOpeningHours {
  periods: OpeningPeriod[];
}

/** A moment within a week to test opening hours against. */
export interface WeekTime {
  /** Day of week, 0=Sunday..6=Saturday (matches Google). */
  day: number;
  /** Minutes since midnight, 0..1439. */
  minutes: number;
}

/** Meals that map onto Google's `servesBreakfast`/`servesLunch`/`servesDinner`. */
export type MealService = "breakfast" | "lunch" | "dinner";

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

/** Default time of day (minutes since midnight) used to evaluate each meal. */
export const DEFAULT_MEAL_MINUTES: Record<MealService, number> = {
  breakfast: 8 * 60 + 30, // 08:30
  lunch: 12 * 60 + 30, // 12:30
  dinner: 19 * 60 + 30, // 19:30
};

/** Map a venue category onto the meal whose service it should respect, if any. */
export function mealServiceForCategory(category: VenueCategory): MealService | undefined {
  switch (category) {
    case "lunch":
      return "lunch";
    case "dinner":
      return "dinner";
    default:
      return undefined;
  }
}

/**
 * Parse a 24 hour "HH:MM" string into minutes since midnight.
 * Returns undefined when the value is missing or malformed.
 */
export function parseTimeOfDay(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Build the week moment to evaluate a meal against from a reference date. */
export function resolveMealTarget(
  minutes: number,
  reference: Date = new Date(),
): WeekTime {
  const clamped = Math.min(MINUTES_PER_DAY - 1, Math.max(0, Math.round(minutes)));
  return { day: reference.getDay(), minutes: clamped };
}

function pointToWeekMinutes(point: OpeningHoursPoint): number {
  return point.day * MINUTES_PER_DAY + point.hour * 60 + point.minute;
}

/**
 * Whether a venue is open at the target week moment.
 * Returns undefined when there is no hours data to judge by, so callers can
 * treat "unknown" differently from "known closed".
 */
export function isOpenAt(
  hours: RegularOpeningHours | undefined,
  target: WeekTime,
): boolean | undefined {
  const periods = hours?.periods;
  if (!periods || periods.length === 0) {
    return undefined;
  }

  const targetMinutes = target.day * MINUTES_PER_DAY + target.minutes;

  for (const period of periods) {
    // An open with no close marks a venue that never shuts.
    if (!period.close) {
      return true;
    }
    const openMinutes = pointToWeekMinutes(period.open);
    let closeMinutes = pointToWeekMinutes(period.close);
    // A close at or before the open wraps past the end of the week.
    if (closeMinutes <= openMinutes) {
      closeMinutes += MINUTES_PER_WEEK;
    }
    if (
      (targetMinutes >= openMinutes && targetMinutes < closeMinutes) ||
      (targetMinutes + MINUTES_PER_WEEK >= openMinutes &&
        targetMinutes + MINUTES_PER_WEEK < closeMinutes)
    ) {
      return true;
    }
  }
  return false;
}

/** How well a venue fits the requested meal at the target time. */
export interface MealFit {
  /** True only when the venue is known to be shut at the target time. */
  closed: boolean;
  /** Score penalty, 0 (perfect fit) to 1 (worst), added to the venue score. */
  penalty: number;
}

export interface MealFitInput {
  /** Whether the venue serves this meal, when known. */
  serves?: boolean;
  hours?: RegularOpeningHours;
  target: WeekTime;
}

/** Penalty applied when a venue does not serve the requested meal. */
export const SERVE_PENALTY = 0.4;
/** Penalty applied when a venue is shut at the target time. */
export const CLOSED_PENALTY = 0.6;

/**
 * Judge how well a venue fits a meal at a target time using its serving flags
 * and opening hours. Unknown data is treated neutrally so venues are never
 * punished for missing fields, only for being a clear mismatch.
 */
export function evaluateMealFit(input: MealFitInput): MealFit {
  const open = isOpenAt(input.hours, input.target);
  let penalty = 0;
  if (input.serves === false) {
    penalty += SERVE_PENALTY;
  }
  if (open === false) {
    penalty += CLOSED_PENALTY;
  }
  return { closed: open === false, penalty: Math.min(1, penalty) };
}
