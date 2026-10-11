/** Display formatting. Engine values keep full precision; round only here (§5.6). */
export const score1 = (n: number | null | undefined) => (n == null ? "—" : (Math.round(n * 10) / 10).toFixed(1));
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n)}%`);

export function relativeDays(date: Date | string, now = new Date()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const days = Math.round((+d - +now) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export const dateTime = (d: Date | string) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(d));

export const firstName = (name: string) => name.replace(/^(Dr|Prof|Mr|Ms|Mrs)\.?\s+/i, "").split(/\s+/)[0];

export const shortDate = (d: Date | string) =>
  new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(d));
