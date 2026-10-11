/**
 * Working-day arithmetic for SLAs (§8.1).
 * Skips weekends (Saturday, Sunday) and institution holidays defined in policy.
 */

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toHolidaySet(holidays?: readonly string[] | Set<string>): Set<string> {
  if (!holidays) return new Set();
  return holidays instanceof Set ? holidays : new Set(holidays);
}

export function isWorkingDay(date: Date, holidays?: readonly string[] | Set<string>): boolean {
  const wd = date.getDay();
  if (wd === 0 || wd === 6) return false;
  if (holidays) {
    const set = toHolidaySet(holidays);
    if (set.has(toDateKey(date))) return false;
  }
  return true;
}

export function addWorkingDays(from: Date, days: number, holidays?: readonly string[] | Set<string>): Date {
  const d = new Date(from);
  const holidaySet = toHolidaySet(holidays);
  const step = days >= 0 ? 1 : -1;
  let left = Math.abs(days);
  while (left > 0) {
    d.setDate(d.getDate() + step);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6 && !holidaySet.has(toDateKey(d))) {
      left--;
    }
  }
  return d;
}

export function workingDaysUntil(to: Date, from = new Date(), holidays?: readonly string[] | Set<string>): number {
  const holidaySet = toHolidaySet(holidays);
  const sign = to >= from ? 1 : -1;
  const d = new Date(from);
  let n = 0;
  while (sign > 0 ? d < to : d > to) {
    d.setDate(d.getDate() + sign);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6 && !holidaySet.has(toDateKey(d))) {
      n += sign;
    }
  }
  return n;
}
