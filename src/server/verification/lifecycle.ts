/**
 * Evidence status lifecycle (§6.1). Only the system or a named reviewer can set
 * VERIFIED / ATTESTED; every transition is written to artifact_status_events.
 */
import type { VerificationStatus } from "../policy/schema";

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

export function canTransition(from: VerificationStatus, to: VerificationStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
