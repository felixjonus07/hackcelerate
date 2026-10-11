/** Counseling Kanban (§8.2). */
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { counselingCardMoves, counselingCards, quests, students } from "../db/schema";
import { COUNSELING_COLUMNS } from "../db/schema/enums";
import { getActivePolicy } from "../policy/load";

export type Column = (typeof COUNSELING_COLUMNS)[number];

export async function board(mentorUserId: string) {
  const cards = await db
    .select({
      id: counselingCards.id,
      column: counselingCards.column,
      position: counselingCards.position,
      nextDate: counselingCards.nextDate,
      lastActivityAt: counselingCards.lastActivityAt,
      studentId: students.id,
      pseudonymousId: students.pseudonymousId,
      departmentCode: students.departmentCode,
    })
    .from(counselingCards)
    .innerJoin(students, eq(students.id, counselingCards.studentId))
    .where(eq(counselingCards.mentorUserId, mentorUserId))
    .orderBy(asc(counselingCards.position));
  const questRows = await db.select({ studentId: quests.studentId, status: quests.status }).from(quests);
  const progress = (sid: string) => {
    const qs = questRows.filter((q) => q.studentId === sid);
    return {
      done: qs.filter((q) => q.status === "DONE").length,
      total: qs.length,
    };
  };
  const policy = getActivePolicy();
  const amberAfter = policy.counseling.inactivity_amber_days * 86_400_000;
  const open = cards.filter((c) => c.column !== "CLOSED").length;
  return {
    wipLimit: policy.counseling.wip_limit_per_mentor,
    openCount: open,
    overLimit: open > policy.counseling.wip_limit_per_mentor,
    columns: COUNSELING_COLUMNS.map((col) => ({
      column: col,
      cards: cards
        .filter((c) => c.column === col)
        .map((c) => ({
          ...c,
          quests: progress(c.studentId),
          stale: Date.now() - +c.lastActivityAt > amberAfter,
        })),
    })),
  };
}

export async function moveCard(cardId: string, mentorUserId: string, to: Column, reason: string | null) {
  const [card] = await db
    .select()
    .from(counselingCards)
    .where(and(eq(counselingCards.id, cardId), eq(counselingCards.mentorUserId, mentorUserId)))
    .limit(1);
  if (!card) throw new Error("Card not found");
  const backward = COUNSELING_COLUMNS.indexOf(to) < COUNSELING_COLUMNS.indexOf(card.column);
  if (backward && !reason) throw new Error("Moving a card backward needs a reason");
  if (to === "PLAN_ACTIVE") {
    const accepted = await db
      .select({ id: quests.id })
      .from(quests)
      .where(and(eq(quests.studentId, card.studentId), eq(quests.status, "ACCEPTED")))
      .limit(1);
    if (!accepted.length) throw new Error("Plan active needs at least one accepted quest");
  }
  await db.transaction(async (tx) => {
    await tx
      .update(counselingCards)
      .set({ column: to, lastActivityAt: new Date() })
      .where(eq(counselingCards.id, cardId));
    await tx.insert(counselingCardMoves).values({
      cardId,
      fromColumn: card.column,
      toColumn: to,
      reason,
      actorUserId: mentorUserId,
    });
  });
}
