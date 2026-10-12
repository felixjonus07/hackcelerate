/**
 * Policy version lifecycle (§3.3), as pure functions: DRAFT → ACTIVE → RETIRED,
 * two approvals when persona triggers or floors change, and no retroactive
 * activation for a period already reported to the auditors. The services in
 * `services/policy-admin.ts` apply these rules to the `policy_versions` table.
 */
import type { Policy } from "./schema";

export type PolicyStatus = "DRAFT" | "ACTIVE" | "RETIRED";

export interface PolicyApproval {
  userId: string;
  role: string;
  at: string;
}

/** Roles that may approve a policy version (§11: registrar and a second approver). */
export const POLICY_APPROVER_ROLES = ["registrar", "dean"] as const;

/** Keys that identify a version rather than describe rules; they never count as a rule change. */
const IDENTITY_KEYS = new Set(["policy_version", "status", "status_note", "effective_from"]);

/** Sections whose change needs two approvals (§3.3: "persona triggers or floors"). */
const PERSONA_SECTIONS = ["personas", "persona_precedence"] as const;

/** JSON with sorted keys, so equal policies compare equal whatever their key order. */
export function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, sort(x)]),
      );
    return v;
  };
  return JSON.stringify(sort(value));
}

/** Top-level policy sections that differ between two versions. */
export function changedSections(prev: Policy | null, next: Policy): string[] {
  if (!prev) return Object.keys(next).filter((k) => !IDENTITY_KEYS.has(k));
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  return [...keys]
    .filter((k) => !IDENTITY_KEYS.has(k))
    .filter((k) => canonical((prev as Record<string, unknown>)[k]) !== canonical((next as Record<string, unknown>)[k]))
    .sort();
}

export function personaSectionsChanged(prev: Policy | null, next: Policy): boolean {
  // With no earlier version in force the whole rule set is new, so treat it as a persona change.
  if (!prev) return true;
  const changed = changedSections(prev, next);
  return PERSONA_SECTIONS.some((s) => changed.includes(s));
}

export function approvalsRequired(prev: Policy | null, next: Policy): 1 | 2 {
  return personaSectionsChanged(prev, next) ? 2 : 1;
}

export type ApprovalCheck = { ok: true } | { ok: false; code: "role" | "duplicate" | "same_role"; message: string };

/** Can this user add an approval to a version that already has `existing`? */
export function checkApprover(
  existing: readonly PolicyApproval[],
  user: { id: string; role: string },
  required: 1 | 2,
): ApprovalCheck {
  if (!(POLICY_APPROVER_ROLES as readonly string[]).includes(user.role))
    return { ok: false, code: "role", message: "Only the registrar or the dean can approve a policy version" };
  if (existing.some((a) => a.userId === user.id))
    return { ok: false, code: "duplicate", message: "A second, different approver is required" };
  // Persona changes: both approvals must come from different offices (registrar and dean).
  if (required === 2 && existing.some((a) => a.role === user.role))
    return {
      ok: false,
      code: "same_role",
      message: "A persona change needs one approval from the registrar and one from the dean",
    };
  return { ok: true };
}

export const isFullyApproved = (approvals: readonly PolicyApproval[], required: 1 | 2) => approvals.length >= required;

/** The day an audit report was last exported marks the end of the reported period. */
export function retroactiveActivation(effectiveFrom: string, reportedThrough: string | null): boolean {
  return reportedThrough != null && effectiveFrom.slice(0, 10) <= reportedThrough.slice(0, 10);
}

/**
 * Of the ACTIVE rows, the one in force on `onDate`: the latest `effective_from` that has started;
 * when two share a date, the one activated last. Returns null when none has started yet.
 */
export function inForce<T extends { status: PolicyStatus; effectiveFrom: Date; activatedAt?: Date | null }>(
  rows: readonly T[],
  onDate: Date,
) {
  return (
    rows
      .filter((r) => r.status === "ACTIVE" && r.effectiveFrom <= onDate)
      .sort(
        (a, b) =>
          +b.effectiveFrom - +a.effectiveFrom ||
          +(b.activatedAt ?? b.effectiveFrom) - +(a.activatedAt ?? a.effectiveFrom),
      )[0] ?? null
  );
}
