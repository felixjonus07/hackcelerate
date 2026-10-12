/**
 * Retention (§13.5) and erasure (§13.7), as pure functions over the policy's schedule. Jobs apply the
 * cutoffs; a student's erasure request is first checked against the schedule, and the outcome (what is
 * erased, and anything kept for a legal reason) is explained to the student in writing.
 */
import type { Policy } from "../policy/schema";
import { addDays, localDate } from "./calendar";

const DAY = 86_400_000;
const monthsAgo = (now: Date, months: number) => {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
};
const yearsAgo = (now: Date, years: number) => monthsAgo(now, years * 12);

export interface RetentionCutoffs {
  /** Weekly ERP records older than this date (ISO) are replaced (current academic year plus one). */
  attendanceBefore: string;
  /** Uploaded files for artifacts verified before this instant are deleted. */
  artifactFilesVerifiedBefore: Date;
  /** Students who graduated before this ISO date lose evaluations and narratives; aggregates stay. */
  graduatedBefore: string;
  /** Interventions closed before this instant are deleted. */
  interventionsClosedBefore: Date;
  /** Raw test answers older than this are cleared; scores and percentiles stay. */
  rawAnswersBefore: Date;
  /** Audit events older than this move to the restricted archive. */
  auditBefore: Date;
}

export function retentionCutoffs(policy: Pick<Policy, "retention" | "calendar">, now: Date): RetentionCutoffs {
  const r = policy.retention;
  return {
    attendanceBefore: addDays(policy.calendar.term.start, -Math.round(r.erp_copies.academic_years_after * 365)),
    artifactFilesVerifiedBefore: new Date(now.getTime() - r.artifact_files.days_after_verification * DAY),
    graduatedBefore: localDate(monthsAgo(now, r.evaluations.months_after_graduation), policy.calendar),
    interventionsClosedBefore: yearsAgo(now, r.interventions.years_after_closure),
    rawAnswersBefore: monthsAgo(now, r.mock_raw_answers.months),
    auditBefore: yearsAgo(now, r.audit_events.years),
  };
}

export interface ErasureLine {
  key: keyof Policy["retention"];
  label: string;
  action: "erase_now" | "keep";
  /** In words the student reads. */
  reason: string;
}

const LABELS: Record<keyof Policy["retention"], string> = {
  erp_copies: "Copies of your university records (CGPA and attendance)",
  artifact_files: "Certificates and letters you uploaded",
  evaluations: "Your scores and written summaries",
  interventions: "Records of the support that was offered and approved",
  mock_raw_answers: "Your raw answers to practice tests",
  consent_history: "The history of what you chose to share",
  audit_events: "The log of who viewed your record",
};

/** What an erasure request erases now and what the schedule requires to be kept (§13.7). */
export function erasurePlan(policy: Pick<Policy, "retention">, opts: { hasOpenIntervention: boolean }): ErasureLine[] {
  const r = policy.retention;
  return (Object.keys(LABELS) as (keyof Policy["retention"])[]).map((key) => {
    const row = r[key] as { erasable_on_request: boolean; legal_reason?: string };
    if (key === "interventions" && opts.hasOpenIntervention)
      return {
        key,
        label: LABELS[key],
        action: "keep" as const,
        reason:
          "A proposal for you is still open, so its record is kept until it is closed. After that it follows the normal schedule.",
      };
    if (row.erasable_on_request)
      return { key, label: LABELS[key], action: "erase_now" as const, reason: "Erased because you asked." };
    return {
      key,
      label: LABELS[key],
      action: "keep" as const,
      reason: row.legal_reason ?? "Kept under the institution's retention schedule.",
    };
  });
}

/** The plan as a short letter the student receives (§13.7: "explained to the student in writing"). */
export function erasureLetter(plan: ErasureLine[]): string {
  const erased = plan.filter((l) => l.action === "erase_now").map((l) => `• ${l.label}`);
  const kept = plan.filter((l) => l.action === "keep").map((l) => `• ${l.label}: ${l.reason}`);
  return [
    "We checked your request against the institution's retention schedule.",
    erased.length ? `\nWe will erase:\n${erased.join("\n")}` : "",
    kept.length ? `\nWe must keep, and why:\n${kept.join("\n")}` : "",
    "\nIf you disagree, you can write to the grievance officer named at the bottom of every page.",
  ]
    .filter(Boolean)
    .join("\n");
}
