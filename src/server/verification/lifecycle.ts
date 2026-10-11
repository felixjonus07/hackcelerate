/**
 * Evidence status lifecycle (§6.1). Only the system or a named reviewer can set VERIFIED /
 * ATTESTED; every transition is written to `artifact_status_events` and the audit log, with the
 * actor and the reason. These are the pure rules; `apply.ts` applies them in the database.
 */
import type { Policy, VerificationStatus } from "../policy/schema";
import { addDays } from "../rules/calendar";

export type Actor = "student" | "system" | "reviewer";

/** From → allowed next states (§6.1 table, plus the recheck and sampling paths of §6.2). */
export const TRANSITIONS: Record<VerificationStatus, VerificationStatus[]> = {
  SUBMITTED: ["UNDER_CHECK"],
  UNDER_CHECK: ["VERIFIED", "LIVE_UNVERIFIED", "SELF_REPORTED", "UNVERIFIED", "ATTESTED", "REJECTED"],
  ATTESTED: ["REJECTED", "STALE"],
  VERIFIED: ["STALE"],
  STALE: ["VERIFIED", "UNVERIFIED"],
  LIVE_UNVERIFIED: ["VERIFIED", "STALE", "UNVERIFIED"],
  SELF_REPORTED: ["UNDER_CHECK", "ATTESTED", "REJECTED"],
  UNVERIFIED: ["SUBMITTED"],
  REJECTED: ["SUBMITTED"],
};

/** Who may set each state. A student only ever submits; verified and attested states are never theirs. */
const SETTERS: Record<VerificationStatus, Actor[]> = {
  SUBMITTED: ["student"],
  UNDER_CHECK: ["system"],
  VERIFIED: ["system"],
  LIVE_UNVERIFIED: ["system"],
  SELF_REPORTED: ["system"],
  UNVERIFIED: ["system"],
  ATTESTED: ["reviewer"],
  REJECTED: ["reviewer", "system"],
  STALE: ["system"],
};

export function canTransition(from: VerificationStatus, to: VerificationStatus, actor?: Actor): boolean {
  if (!TRANSITIONS[from]?.includes(to)) return false;
  return actor === undefined || SETTERS[to].includes(actor);
}

export class TransitionError extends Error {}

export function assertTransition(from: VerificationStatus, to: VerificationStatus, actor: Actor) {
  if (!TRANSITIONS[from]?.includes(to)) throw new TransitionError(`${from} → ${to} is not an allowed transition`);
  if (!SETTERS[to].includes(actor)) throw new TransitionError(`A ${actor} cannot set ${to}`);
}

/**
 * Outcome of a scheduled re-check (§6.1): one failure makes VERIFIED stale, a second makes it
 * UNVERIFIED; a pass restores a stale item. An item whose check cannot run changes nothing.
 */
export function afterRecheck(current: VerificationStatus, passed: boolean): VerificationStatus {
  switch (current) {
    case "VERIFIED":
      return passed ? "VERIFIED" : "STALE";
    case "STALE":
      return passed ? "VERIFIED" : "UNVERIFIED";
    case "LIVE_UNVERIFIED":
      return passed ? "LIVE_UNVERIFIED" : "STALE";
    default:
      return current;
  }
}

/** When the next automatic re-check is due, or null for items that are not re-checked (§6.2). */
export function nextCheckAfter(
  status: VerificationStatus,
  kind: "github" | "crossref" | "link" | "certificate" | "platform" | "reviewer",
  from: Date,
  policy: Pick<Policy, "verification">,
): Date | null {
  const days =
    kind === "github"
      ? policy.verification.github.recheck_days
      : kind === "link"
        ? policy.verification.portfolio_recheck_days
        : null;
  if ((status === "VERIFIED" || status === "LIVE_UNVERIFIED" || status === "STALE") && days != null)
    return new Date(from.getTime() + days * 86_400_000);
  if (status === "ATTESTED") return new Date(from.getTime() + policy.verification.attested_review_days * 86_400_000);
  return null;
}

/** An attestation lapses to STALE once its review period has passed. */
export function attestationExpired(attestedAt: Date, now: Date, policy: Pick<Policy, "verification">): boolean {
  return now.getTime() >= attestedAt.getTime() + policy.verification.attested_review_days * 86_400_000;
}

/** The ISO date by which a quest-named URL must have been reachable (§4.3). */
export const reachableBy = (submittedOn: string, withinDays: number) => addDays(submittedOn, withinDays);
