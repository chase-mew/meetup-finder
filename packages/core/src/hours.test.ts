import { describe, expect, it } from "vitest";
import {
  CLOSED_PENALTY,
  DEFAULT_MEAL_MINUTES,
  type RegularOpeningHours,
  SERVE_PENALTY,
  evaluateMealFit,
  isOpenAt,
  mealServiceForCategory,
  parseTimeOfDay,
  resolveMealTarget,
} from "./hours";

// Open 11:00-15:00 and 18:00-23:00 every day of the week.
const SPLIT_SHIFT: RegularOpeningHours = {
  periods: Array.from({ length: 7 }, (_, day) => [
    { open: { day, hour: 11, minute: 0 }, close: { day, hour: 15, minute: 0 } },
    { open: { day, hour: 18, minute: 0 }, close: { day, hour: 23, minute: 0 } },
  ]).flat(),
};

describe("parseTimeOfDay", () => {
  it("parses valid 24 hour times", () => {
    expect(parseTimeOfDay("00:00")).toBe(0);
    expect(parseTimeOfDay("12:30")).toBe(750);
    expect(parseTimeOfDay("23:59")).toBe(1439);
    expect(parseTimeOfDay("9:05")).toBe(545);
  });

  it("rejects malformed or out of range values", () => {
    expect(parseTimeOfDay("24:00")).toBeUndefined();
    expect(parseTimeOfDay("12:60")).toBeUndefined();
    expect(parseTimeOfDay("noon")).toBeUndefined();
    expect(parseTimeOfDay(undefined)).toBeUndefined();
    expect(parseTimeOfDay(750)).toBeUndefined();
  });
});

describe("mealServiceForCategory", () => {
  it("maps only lunch and dinner", () => {
    expect(mealServiceForCategory("lunch")).toBe("lunch");
    expect(mealServiceForCategory("dinner")).toBe("dinner");
    expect(mealServiceForCategory("cafe")).toBeUndefined();
    expect(mealServiceForCategory("pub")).toBeUndefined();
  });
});

describe("resolveMealTarget", () => {
  it("uses the reference day and clamps minutes into a single day", () => {
    const sunday = new Date("2026-06-14T00:00:00Z"); // getDay() === 0 locally
    const target = resolveMealTarget(DEFAULT_MEAL_MINUTES.lunch, sunday);
    expect(target.day).toBe(sunday.getDay());
    expect(target.minutes).toBe(750);
    expect(resolveMealTarget(99_999, sunday).minutes).toBe(1439);
    expect(resolveMealTarget(-10, sunday).minutes).toBe(0);
  });
});

describe("isOpenAt", () => {
  it("returns undefined when there is no hours data", () => {
    expect(isOpenAt(undefined, { day: 1, minutes: 720 })).toBeUndefined();
    expect(isOpenAt({ periods: [] }, { day: 1, minutes: 720 })).toBeUndefined();
  });

  it("knows when a venue is open or shut at the target time", () => {
    expect(isOpenAt(SPLIT_SHIFT, { day: 1, minutes: 12 * 60 })).toBe(true); // lunch
    expect(isOpenAt(SPLIT_SHIFT, { day: 1, minutes: 19 * 60 })).toBe(true); // dinner
    expect(isOpenAt(SPLIT_SHIFT, { day: 1, minutes: 16 * 60 })).toBe(false); // afternoon gap
    expect(isOpenAt(SPLIT_SHIFT, { day: 1, minutes: 9 * 60 })).toBe(false); // before open
  });

  it("treats an open period with no close as always open", () => {
    const always: RegularOpeningHours = {
      periods: [{ open: { day: 0, hour: 0, minute: 0 } }],
    };
    expect(isOpenAt(always, { day: 3, minutes: 3 * 60 })).toBe(true);
  });

  it("handles periods that wrap past midnight", () => {
    const lateNight: RegularOpeningHours = {
      periods: [{ open: { day: 5, hour: 20, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }],
    };
    expect(isOpenAt(lateNight, { day: 5, minutes: 23 * 60 })).toBe(true);
    expect(isOpenAt(lateNight, { day: 6, minutes: 1 * 60 })).toBe(true);
    expect(isOpenAt(lateNight, { day: 6, minutes: 3 * 60 })).toBe(false);
  });
});

describe("evaluateMealFit", () => {
  const target = { day: 1, minutes: DEFAULT_MEAL_MINUTES.lunch };

  it("does not penalise a serving, open venue", () => {
    const fit = evaluateMealFit({ serves: true, hours: SPLIT_SHIFT, target });
    expect(fit.closed).toBe(false);
    expect(fit.penalty).toBe(0);
  });

  it("penalises a venue that does not serve the meal", () => {
    const fit = evaluateMealFit({ serves: false, hours: SPLIT_SHIFT, target });
    expect(fit.penalty).toBe(SERVE_PENALTY);
    expect(fit.closed).toBe(false);
  });

  it("flags and penalises a venue shut at the target time", () => {
    const dinnerTarget = { day: 1, minutes: 16 * 60 };
    const fit = evaluateMealFit({ serves: true, hours: SPLIT_SHIFT, target: dinnerTarget });
    expect(fit.closed).toBe(true);
    expect(fit.penalty).toBe(CLOSED_PENALTY);
  });

  it("stays neutral when nothing is known", () => {
    const fit = evaluateMealFit({ target });
    expect(fit.closed).toBe(false);
    expect(fit.penalty).toBe(0);
  });

  it("caps the penalty at one when a venue both misses the meal and is shut", () => {
    const fit = evaluateMealFit({ serves: false, hours: SPLIT_SHIFT, target: { day: 1, minutes: 16 * 60 } });
    expect(fit.penalty).toBe(1);
  });
});
