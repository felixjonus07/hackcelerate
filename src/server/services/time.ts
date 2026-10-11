/** Working-day arithmetic for SLAs (§8.1). Holiday calendar is a Phase 4 task. */
export function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

export function workingDaysUntil(to: Date, from = new Date()): number {
  const sign = to >= from ? 1 : -1;
  const d = new Date(from);
  let n = 0;
  while (sign > 0 ? d < to : d > to) {
    d.setDate(d.getDate() + sign);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) n += sign;
  }
  return n;
}
