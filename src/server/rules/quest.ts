/**
 * Quest lifecycle (§8.3): Proposed → Accepted → Active → Evidence submitted → Done / Expired. A quest is
 * completed only by evidence of the type it names that actually counts. An expired quest is not a
 * failure and lowers no score, because the score already reflects the evidence that is missing.
 */
import type { Policy, VerificationStatus } from "../policy/schema";
import { multiplier } from "./normalize";

export const QUEST_STATES = ["PROPOSED", "ACCEPTED", "ACTIVE", "EVIDENCE_SUBMITTED", "DONE", "EXPIRED"] as const;
export type QuestState = (typeof QUEST_STATES)[number];
export type QuestEvent =
  | "accept"
  | "start"
  | "submit_evidence"
  | "evidence_counted"
  | "evidence_rejected"
  | "expire"
  | "reopen";

const NEXT: Record<QuestState, Partial<Record<QuestEvent, QuestState>>> = {
  PROPOSED: { accept: "ACCEPTED" },
  ACCEPTED: { start: "ACTIVE", submit_evidence: "EVIDENCE_SUBMITTED", expire: "EXPIRED" },
  ACTIVE: { submit_evidence: "EVIDENCE_SUBMITTED", expire: "EXPIRED" },
  EVIDENCE_SUBMITTED: { evidence_counted: "DONE", evidence_rejected: "ACTIVE" },
  DONE: {},
  EXPIRED: { reopen: "ACCEPTED" },
};

export function nextQuestState(from: QuestState, event: QuestEvent): QuestState | null {
  return NEXT[from][event] ?? null;
}

/** States in which the student has begun the work (an accepted quest or beyond). */
export const STARTED_STATES: readonly QuestState[] = ["ACCEPTED", "ACTIVE", "EVIDENCE_SUBMITTED", "DONE"];

export interface QuestRef {
  requiredEvidenceType: string;
  componentKey: string | null;
  standardItem: string | null;
}
export interface ArtifactRef {
  type: string;
  component: string;
  standardItem: string | null;
  status: VerificationStatus;
}

/** Does this artifact complete the quest? It must be the named type, for the same item, and count. */
export function evidenceCompletesQuest(
  quest: QuestRef,
  a: ArtifactRef,
  policy: Pick<Policy, "verification_multipliers">,
): { ok: true } | { ok: false; reason: string } {
  if (a.type !== quest.requiredEvidenceType)
    return { ok: false, reason: `This quest needs evidence of type "${quest.requiredEvidenceType}"` };
  if (quest.standardItem && a.standardItem !== quest.standardItem)
    return { ok: false, reason: "The evidence is for a different item than the quest names" };
  if (quest.componentKey && a.component !== quest.componentKey && a.component !== "general")
    return { ok: false, reason: "The evidence is for a different part of your plan" };
  if (multiplier(a.status, policy as Policy) <= 0)
    return {
      ok: false,
      reason: `The evidence is ${a.status.replace("_", " ").toLowerCase()}, so it does not count yet`,
    };
  return { ok: true };
}

/** Target days must sit inside the policy range (§9.1 "within the allowed range"). */
export function clampTargetDays(days: number, range: readonly [number, number]): number {
  return Math.min(range[1], Math.max(range[0], Math.round(days)));
}

export const dueDate = (from: Date, targetDays: number) => new Date(from.getTime() + targetDays * 86_400_000);

/** An accepted quest passes its date with no evidence: the system expires it. */
export function shouldExpire(q: { status: QuestState; dueAt: Date | null }, now: Date): boolean {
  return (q.status === "ACCEPTED" || q.status === "ACTIVE") && q.dueAt != null && q.dueAt.getTime() < now.getTime();
}
