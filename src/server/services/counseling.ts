/** Counseling Kanban (§8.2). */
import { and, asc, eq, inArray } from "drizzle-orm";
import { auditMany } from "../audit/log";
import { db } from "../db";
import { counselingCardMoves, counselingCards, quests, staffAssignments, students } from "../db/schema";
import { COUNSELING_COLUMNS } from "../db/schema/enums";
import { getActivePolicy } from "../policy/load";
import { STARTED_STATES } from "../rules/quest";

export type Column = (typeof COUNSELING_COLUMNS)[number];

export async function board(mentor: { id: string; role: string }) {
  const mentorUserId = mentor.id;
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
  const questRows = await db
    .select({ studentId: quests.studentId, status: quests.status })
    .from(quests)
    .where(inArray(quests.studentId, cards.length ? cards.map((c) => c.studentId) : [crypto.randomUUID()]));
  const progress = (sid: string) => {
    const qs = questRows.filter((q) => q.studentId === sid);
    return {
      done: qs.filter((q) => q.status === "DONE").length,
      total: qs.length,
    };
  };
  await auditMany(
    cards.map((c) => ({
      actorUserId: mentor.id,
      actorRole: mentor.role,
      action: "student_record.list_view",
      entityType: "student",
      entityId: c.pseudonymousId,
      purpose: "counseling_board",
      fieldsAccessed: ["counseling_card", "quests.progress"],
      result: "allowed" as const,
    })),
  );
  const policy = await getActivePolicy();
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
      .where(and(eq(quests.studentId, card.studentId), inArray(quests.status, [...STARTED_STATES])))
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

/** The student's assigned faculty mentor, who owns the counseling card (§8.2). */
export async function mentorOf(studentId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: staffAssignments.staffUserId })
    .from(staffAssignments)
    .where(and(eq(staffAssignments.studentId, studentId), eq(staffAssignments.role, "faculty_mentor")))
    .limit(1);
  return row?.id ?? null;
}

/** One open card per student with a route in progress (§8.2): reuse it, or open one in `column`. */
export async function ensureCard(studentId: string, interventionId: string | null, column: Column = "REFERRED") {
  const mentor = await mentorOf(studentId);
  if (!mentor) return null;
  const open = (await db.select().from(counselingCards).where(eq(counselingCards.studentId, studentId))).find(
    (c) => c.column !== "CLOSED",
  );
  if (open) return open;
  const [card] = await db
    .insert(counselingCards)
    .values({ studentId, interventionId, mentorUserId: mentor, column })
    .returning();
  return card;
}

/** Moves made by the system, such as an expired quest sending a card to Follow-up due (§8.2). */
export async function moveCardAsSystem(cardId: string, to: Column, reason: string) {
  const [card] = await db.select().from(counselingCards).where(eq(counselingCards.id, cardId)).limit(1);
  if (!card || card.column === to) return false;
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
      actorUserId: null,
      actorKind: "system",
    });
  });
  return true;
}

/** The mentor schedules the next step on a card (§12.2). */
export async function scheduleCard(cardId: string, mentorUserId: string, nextDate: Date) {
  const rows = await db
    .update(counselingCards)
    .set({ nextDate, lastActivityAt: new Date() })
    .where(and(eq(counselingCards.id, cardId), eq(counselingCards.mentorUserId, mentorUserId)))
    .returning({ id: counselingCards.id });
  if (!rows.length) throw new Error("Card not found");
}
