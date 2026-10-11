/**
 * Quest lifecycle jobs (§8.3).
 * - runQuestExpiry: expires overdue quests and moves counseling cards to FOLLOW_UP_DUE.
 */
import { and, eq, lt } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import { artifacts, counselingCards, quests } from "../db/schema";
import { COUNSELING_COLUMNS } from "../db/schema/enums";

/**
 * Marks overdue quests (ACCEPTED or ACTIVE, past dueAt) as EXPIRED and moves
 * the student's counseling card to FOLLOW_UP_DUE (§8.3, §8.2).
 * Called by the maintenance worker.
 */
export async function runQuestExpiry(): Promise<{ expired: number }> {
  const now = new Date();

  // Find quests that are past due and not yet closed.
  const overdueQuests = await db
    .select()
    .from(quests)
    .where(
      and(
        lt(quests.dueAt, now),
        // Only expire active/accepted quests (not already done or expired)
        eq(quests.status, "ACCEPTED"),
      ),
    );

  // Also catch ACTIVE ones
  const overdueActive = await db
    .select()
    .from(quests)
    .where(and(lt(quests.dueAt, now), eq(quests.status, "ACTIVE")));

  const allOverdue = [...overdueQuests, ...overdueActive];
  let expired = 0;

  for (const q of allOverdue) {
    await db.update(quests).set({ status: "EXPIRED" }).where(eq(quests.id, q.id));

    // Move counseling card for this student to FOLLOW_UP_DUE if it exists
    // and is not already in FOLLOW_UP_DUE or CLOSED.
    const [card] = await db.select().from(counselingCards).where(eq(counselingCards.studentId, q.studentId)).limit(1);

    if (card) {
      const currentIdx = COUNSELING_COLUMNS.indexOf(card.column);
      const followUpIdx = COUNSELING_COLUMNS.indexOf("FOLLOW_UP_DUE");
      const closedIdx = COUNSELING_COLUMNS.indexOf("CLOSED");
      // Only advance to FOLLOW_UP_DUE if not already there or beyond CLOSED.
      if (currentIdx < followUpIdx && currentIdx < closedIdx) {
        await db
          .update(counselingCards)
          .set({ column: "FOLLOW_UP_DUE", lastActivityAt: now })
          .where(eq(counselingCards.id, card.id));
      }
    }

    await audit({
      actorUserId: "system",
      actorRole: "system",
      action: "quest.expired",
      entityType: "quest",
      entityId: q.id,
      purpose: "quest_expiry",
      result: "allowed",
    });
    expired++;
  }

  return { expired };
}

/**
 * Marks a quest as DONE only when the verification service confirms the linked
 * artifact is VERIFIED or ATTESTED AND its type matches the quest's requiredEvidenceType (§8.3).
 * Called by the verification worker after each successful artifact check.
 */
export async function completeQuestOnVerification(artifactId: string): Promise<boolean> {
  // Find quests in EVIDENCE_SUBMITTED that reference this artifact.
  const [q] = await db
    .select()
    .from(quests)
    .where(and(eq(quests.evidenceArtifactId, artifactId), eq(quests.status, "EVIDENCE_SUBMITTED")))
    .limit(1);

  if (!q) return false;

  const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);

  if (!artifact) return false;

  // Quest completes ONLY with evidence of the named type (§8.3)
  if (artifact.type !== q.requiredEvidenceType) return false;

  // Must be verified or attested
  if (artifact.status !== "VERIFIED" && artifact.status !== "ATTESTED") return false;

  await db.update(quests).set({ status: "DONE" }).where(eq(quests.id, q.id));
  await audit({
    actorUserId: "system",
    actorRole: "system",
    action: "quest.done",
    entityType: "quest",
    entityId: q.id,
    purpose: "evidence_verified",
    result: "allowed",
  });
  return true;
}
