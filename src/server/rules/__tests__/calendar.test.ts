/** Working-day arithmetic (§8.1): weekends, an institution holiday calendar, local time. */
import { describe, expect, it } from "vitest";
import {
  addDays,
  addWorkingDays,
  ageInYears,
  type Calendar,
  diffDays,
  isWorkingDay,
  localDate,
  mondayOf,
  weekday,
  workingDaysBetween,
} from "../calendar";

const cal: Calendar = { weekend_days: [0, 6], holidays: ["2026-10-20"], utc_offset_minutes: 330 };
const at = (iso: string) => new Date(iso);

describe("dates", () => {
  it("adds and diffs days across month ends and leap years", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(diffDays("2026-10-11", "2026-10-18")).toBe(7);
    expect(diffDays("2026-10-18", "2026-10-11")).toBe(-7);
  });
  it("finds the weekday and the Monday of a week", () => {
    expect(weekday("2026-10-11")).toBe(0); // Sunday
    expect(mondayOf("2026-10-11")).toBe("2026-10-05");
    expect(mondayOf("2026-10-12")).toBe("2026-10-12");
    expect(mondayOf("2026-10-17")).toBe("2026-10-12");
  });
  it("converts an instant to the institution's local date", () => {
    expect(localDate(at("2026-10-11T20:00:00Z"), cal)).toBe("2026-10-12"); // 01:30 IST next day
    expect(localDate(at("2026-10-11T10:00:00Z"), cal)).toBe("2026-10-11");
  });
  it("computes age in whole years", () => {
    expect(ageInYears("2008-10-12", "2026-10-11")).toBe(17);
    expect(ageInYears("2008-10-11", "2026-10-11")).toBe(18);
    expect(ageInYears("2000-02-29", "2026-02-28")).toBe(25);
  });
});

describe("working days", () => {
  it("skips weekends and holidays", () => {
    expect(isWorkingDay("2026-10-19", cal)).toBe(true);
    expect(isWorkingDay("2026-10-20", cal)).toBe(false); // holiday
    expect(isWorkingDay("2026-10-24", cal)).toBe(false); // Saturday
  });

  it("two working days from a Thursday is Monday", () => {
    // Thu 2026-10-15 + 2 working days = Fri 16, then Mon 19.
    expect(addWorkingDays(at("2026-10-15T06:00:00Z"), 2, cal).toISOString()).toBe("2026-10-19T06:00:00.000Z");
  });

  it("counts from the next working day when started on a weekend", () => {
    // Sat 2026-10-17 + 2 = Mon 19, Tue 20 is a holiday, so Wed 21.
    expect(localDate(addWorkingDays(at("2026-10-17T06:00:00Z"), 2, cal), cal)).toBe("2026-10-21");
  });

  it("skips a holiday inside the span", () => {
    // Mon 19 + 1 working day: Tue 20 is a holiday, so Wed 21.
    expect(localDate(addWorkingDays(at("2026-10-19T06:00:00Z"), 1, cal), cal)).toBe("2026-10-21");
  });

  it("zero days returns the same instant; negative days are rejected", () => {
    expect(addWorkingDays(at("2026-10-15T06:00:00Z"), 0, cal).toISOString()).toBe("2026-10-15T06:00:00.000Z");
    expect(() => addWorkingDays(at("2026-10-15T06:00:00Z"), -1, cal)).toThrow(RangeError);
  });

  it("keeps the local date when the instant is just after local midnight", () => {
    // 2026-10-15T19:00Z is 00:30 IST on Fri 16; one working day later is Mon 19.
    expect(localDate(addWorkingDays(at("2026-10-15T19:00:00Z"), 1, cal), cal)).toBe("2026-10-19");
  });

  it("workingDaysBetween inverts addWorkingDays", () => {
    const from = at("2026-10-15T06:00:00Z");
    for (const n of [0, 1, 2, 5, 9, 14]) expect(workingDaysBetween(from, addWorkingDays(from, n, cal), cal)).toBe(n);
  });

  it("workingDaysBetween is negative when the target is earlier", () => {
    expect(workingDaysBetween(at("2026-10-19T06:00:00Z"), at("2026-10-15T06:00:00Z"), cal)).toBe(-2);
  });
});
