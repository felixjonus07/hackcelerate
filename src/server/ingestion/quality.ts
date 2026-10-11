/**
 * Data-quality rules (§4.3) as pure functions, one block per row of the table.
 * Every limit comes from `policy.data_quality`; nothing here reads the clock or
 * the database. Callers decide what a failure means for scoring (the "If it
 * fails" column), using the reasons returned here.
 */
import type { Policy } from "../policy/schema";
import { addDays, ageInYears, diffDays, mondayOf } from "../rules/calendar";

export type QualityResult = { ok: true } | { ok: false; reason: string };

const OK: QualityResult = { ok: true };
const fail = (reason: string): QualityResult => ({ ok: false, reason });

// ── CGPA: between 0 and the scale maximum. Fails → excluded from scoring; data gap recorded.

export function checkCgpa(cgpa: number | null | undefined, scaleMax: number): QualityResult {
  if (cgpa == null || Number.isNaN(cgpa)) return fail("CGPA missing");
  return cgpa >= 0 && cgpa <= scaleMax ? OK : fail(`CGPA ${cgpa} is outside 0–${scaleMax}`);
}

// ── Attendance: attended ≤ held and held > 0. Fails → the week is excluded.
//    More than two missing weeks lower confidence to MEDIUM, and further still to LOW.

export function checkAttendanceWeek(held: number, attended: number): QualityResult {
  if (!Number.isInteger(held) || !Number.isInteger(attended)) return fail("Class counts must be whole numbers");
  if (held <= 0) return fail("Classes held must be greater than 0");
  if (attended < 0) return fail("Classes attended cannot be negative");
  return attended <= held ? OK : fail("Classes attended exceed classes held");
}

export interface WeekRecord {
  weekStart: string;
  held: number;
  attended: number;
}

export interface AttendanceQuality {
  /** Valid records, one per week (a week's courses are summed), inside the current term. */
  weeks: { weekStart: string; held: number; attended: number }[];
  excluded: { weekStart: string; reason: string }[];
  /** Weeks in the look-back window that have no valid record. */
  missingWeeks: number;
  /** Which confidence cap the missing weeks imply (§4.3). */
  cap: "NONE" | "MEDIUM" | "LOW";
}

export function assessAttendance(
  records: readonly WeekRecord[],
  asOf: string,
  policy: Pick<Policy, "data_quality" | "calendar">,
): AttendanceQuality {
  const dq = policy.data_quality;
  const termStart = mondayOf(policy.calendar.term.start);
  const excluded: AttendanceQuality["excluded"] = [];
  const byWeek = new Map<string, { held: number; attended: number }>();
  for (const r of records) {
    const wk = mondayOf(r.weekStart);
    if (wk < termStart || wk > policy.calendar.term.end) continue;
    const check = checkAttendanceWeek(r.held, r.attended);
    if (!check.ok) {
      excluded.push({ weekStart: wk, reason: check.reason });
      continue;
    }
    const cur = byWeek.get(wk) ?? { held: 0, attended: 0 };
    cur.held += r.held;
    cur.attended += r.attended;
    byWeek.set(wk, cur);
  }
  // A week with any invalid course row is not trustworthy as a whole: drop it.
  for (const e of excluded) byWeek.delete(e.weekStart);

  const thisMonday = mondayOf(asOf);
  const windowStart = addDays(thisMonday, -7 * (dq.attendance_window_weeks - 1));
  let missing = 0;
  for (let wk = windowStart < termStart ? termStart : windowStart; wk <= thisMonday; wk = addDays(wk, 7))
    if (wk <= policy.calendar.term.end && !byWeek.has(wk)) missing++;

  const cap =
    missing > dq.attendance_missing_weeks_low_over
      ? "LOW"
      : missing > dq.attendance_missing_weeks_medium_over
        ? "MEDIUM"
        : "NONE";
  return {
    weeks: [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, v]) => ({ weekStart, ...v })),
    excluded,
    missingWeeks: missing,
    cap,
  };
}

/** Attendance for the term as a percentage, or null when no valid week exists. */
export function termAttendancePct(weeks: readonly { held: number; attended: number }[]): number | null {
  const held = weeks.reduce((n, w) => n + w.held, 0);
  if (held === 0) return null;
  return Math.round((weeks.reduce((n, w) => n + w.attended, 0) / held) * 10_000) / 100;
}

// ── Mock attempt: score within the test range, seconds per item present.
//    Fails → stored but flagged, and excluded from percentile scoring.

export function checkMockAttempt(m: {
  score: number | null | undefined;
  maxScore: number;
  avgSecondsPerItem: number | null | undefined;
}): QualityResult {
  if (m.score == null || Number.isNaN(m.score)) return fail("Score missing");
  if (m.score < 0 || m.score > m.maxScore) return fail(`Score ${m.score} is outside the test range 0–${m.maxScore}`);
  if (m.avgSecondsPerItem == null || !(m.avgSecondsPerItem > 0)) return fail("Seconds per item missing");
  return OK;
}

// ── Artifact URL: valid scheme; reachable within 14 days of submission.
//    Fails → UNVERIFIED with the reason recorded.

export function checkArtifactUrl(raw: string, policy: Pick<Policy, "data_quality">): QualityResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("The link is not a valid URL");
  }
  const scheme = url.protocol.replace(":", "");
  return policy.data_quality.artifact_url_schemes.includes(scheme)
    ? OK
    : fail(`The link scheme "${scheme}" is not accepted`);
}

/** True once the reachability window has run out without a successful check. */
export function reachabilityWindowExpired(
  submittedOn: string,
  today: string,
  policy: Pick<Policy, "data_quality">,
): boolean {
  return diffDays(submittedOn, today) > policy.data_quality.artifact_reachable_within_days;
}

// ── Student ID: matches the ERP roll number format. Fails → row rejected at import, logged for the registrar.

export function checkRollNumber(roll: string, pattern: string): QualityResult {
  return new RegExp(pattern).test(roll) ? OK : fail(`Roll number ${roll} does not match the ERP format`);
}

// ── Date of birth: present and consistent with year of study. Under 18 → parental consent check.

export type DobCheck = { ok: true; minor: boolean; age: number } | { ok: false; reason: string };

export function checkDateOfBirth(
  dateOfBirth: string | null | undefined,
  yearOfStudy: number,
  asOf: string,
  policy: Pick<Policy, "data_quality">,
): DobCheck {
  if (!dateOfBirth) return { ok: false, reason: "Date of birth missing" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || Number.isNaN(Date.parse(dateOfBirth)))
    return { ok: false, reason: "Date of birth is not a valid date" };
  if (dateOfBirth > asOf) return { ok: false, reason: "Date of birth is in the future" };
  const age = ageInYears(dateOfBirth, asOf);
  const [lo, hi] = policy.data_quality.year1_age_range_years;
  const offset = Math.max(0, yearOfStudy - 1);
  if (age < lo + offset || age > hi + offset)
    return { ok: false, reason: `Age ${age} is not consistent with year ${yearOfStudy} of study` };
  return { ok: true, minor: age < policy.data_quality.minor_age_years, age };
}

/** Under the age of majority on `asOf`; false when the date of birth is missing or unusable. */
export function isMinor(
  dateOfBirth: string | null | undefined,
  asOf: string,
  policy: Pick<Policy, "data_quality">,
): boolean {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || dateOfBirth > asOf) return false;
  return ageInYears(dateOfBirth, asOf) < policy.data_quality.minor_age_years;
}
