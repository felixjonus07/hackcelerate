/**
 * Calendar arithmetic for the rules engine (§8.1 working-day SLAs, §4.3 term
 * attendance and age checks). Pure: instants are passed in, never read, and the
 * institution's weekends, holidays and UTC offset come from the policy.
 *
 * Dates are ISO `yyyy-mm-dd` strings in the institution's local time. Instants
 * (`Date`) convert to a local date by adding the policy's UTC offset.
 */
export interface Calendar {
  weekend_days: number[];
  holidays: string[];
  /** Minutes east of UTC (IST = 330). */
  utc_offset_minutes: number;
}

const MS_DAY = 86_400_000;
const MS_MINUTE = 60_000;

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / MS_DAY;
};
const isoOf = (n: number) => new Date(n * MS_DAY).toISOString().slice(0, 10);

/** The institution-local calendar date of an instant. */
export const localDate = (instant: Date, cal: Pick<Calendar, "utc_offset_minutes">): string =>
  new Date(instant.getTime() + cal.utc_offset_minutes * MS_MINUTE).toISOString().slice(0, 10);

export const addDays = (iso: string, days: number): string => isoOf(dayNumber(iso) + days);

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export const diffDays = (a: string, b: string): number => dayNumber(b) - dayNumber(a);

/** Day of week, 0 = Sunday. */
export const weekday = (iso: string): number => new Date(dayNumber(iso) * MS_DAY).getUTCDay();

/** The Monday on or before a date: the key for a week of attendance. */
export const mondayOf = (iso: string): string => addDays(iso, -((weekday(iso) + 6) % 7));

export function isWorkingDay(iso: string, cal: Pick<Calendar, "weekend_days" | "holidays">): boolean {
  return !cal.weekend_days.includes(weekday(iso)) && !cal.holidays.includes(iso.slice(0, 10));
}

/**
 * `n` working days after `from`, keeping the local time of day. Counting starts the
 * day after `from`, so two working days from a Saturday is Tuesday (Monday and Tuesday).
 */
export function addWorkingDays(from: Date, n: number, cal: Calendar): Date {
  if (n < 0) throw new RangeError("addWorkingDays takes a non-negative number of days");
  let day = localDate(from, cal);
  let left = n;
  while (left > 0) {
    day = addDays(day, 1);
    if (isWorkingDay(day, cal)) left--;
  }
  return new Date(from.getTime() + diffDays(localDate(from, cal), day) * MS_DAY);
}

/**
 * Working days in (from, to], counted on local dates; negative when `to` is before `from`.
 * `workingDaysBetween(a, addWorkingDays(a, n))` is `n`.
 */
export function workingDaysBetween(from: Date, to: Date, cal: Calendar): number {
  const a = localDate(from, cal);
  const b = localDate(to, cal);
  if (a === b) return 0;
  const [lo, hi, sign] = a < b ? [a, b, 1] : [b, a, -1];
  let n = 0;
  for (let d = addDays(lo, 1); d <= hi; d = addDays(d, 1)) if (isWorkingDay(d, cal)) n++;
  return n * sign;
}

/** Age in whole years on `onDate` (both ISO dates). */
export function ageInYears(dateOfBirth: string, onDate: string): number {
  const [by, bm, bd] = dateOfBirth.slice(0, 10).split("-").map(Number);
  const [y, m, d] = onDate.slice(0, 10).split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
