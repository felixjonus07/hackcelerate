/**
 * Quests (§8.3, §12.1): accept, start, edit or defer; completion only through evidence of the type the
 * quest names that actually counts; expiry sends the mentor a follow-up, never a mark against the student.
 */
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import { artifacts, quests, students } from "../db/schema";
import { logger } from "../logger";
import { notify } from "../notifications";
import { getActivePolicy } from "../policy/load";
import { enqueue } from "../queue";
import {
  clampTargetDays,
  dueDate,
  evidenceCompletesQuest,
  nextQuestState,
  type QuestState,
  shouldExpire,
} from "../rules/quest";
import { ensureCard, mentorOf, moveCardAsSystem } from "./counseling";

export class QuestError extends Error {}

type Actor = { id: string; role: string };

async function own(studentId: string, questId: string) {
  const [q] = await db
    .select()
    .from(quests)
    .where(and(eq(quests.id, questId), eq(quests.studentId, studentId)))
    .limit(1);
  if (!q) throw new QuestError("That quest isn't on your list any more.");
  return q;
}

const log = (actor: Actor, action: string, pseudonym: string, questId: string) =>
  audit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action,
    entityType: "quest",
    entityId: questId,
    purpose: "quest_lifecycle",
    fieldsAccessed: [pseudonym],
    result: "allowed",
  });

export async function acceptQuest(
  student: { id: string; pseudonymousId: string },
  actor: Actor,
  questId: string,
  now = new Date(),
) {
  const policy = await getActivePolicy();
  const q = await own(student.id, questId);
  const next = nextQuestState(q.status, "accept");
  if (!next) throw new QuestError("This quest has already been accepted.");
  const open = await db
    .select({ id: quests.id })
    .from(quests)
    .where(and(eq(quests.studentId, student.id), inArray(quests.status, ["ACCEPTED", "ACTIVE", "EVIDENCE_SUBMITTED"])));
  if (open.length >= policy.quests.max_open_per_student)
    throw new QuestError("Finish or put off one of your open quests before accepting another.");
  await db
    .update(quests)
    .set({ status: next, acceptedAt: now, dueAt: dueDate(now, q.targetDays), deferredUntil: null, statusNote: null })
    .where(eq(quests.id, q.id));
  await log(actor, "quest.accept", student.pseudonymousId, q.id);
}

export async function startQuest(student: { id: string; pseudonymousId: string }, actor: Actor, questId: string) {
  const q = await own(student.id, questId);
  const next = nextQuestState(q.status, "start");
  if (!next) throw new QuestError("Accept this quest before starting it.");
  await db.update(quests).set({ status: next }).where(eq(quests.id, q.id));
  await log(actor, "quest.start", student.pseudonymousId, q.id);
}

/** Put a proposed quest off; it stays on the list and comes back after the policy's deferral (§12.1). */
export async function deferQuest(
  student: { id: string; pseudonymousId: string },
  actor: Actor,
  questId: string,
  now = new Date(),
) {
  const policy = await getActivePolicy();
  const q = await own(student.id, questId);
  if (q.status !== "PROPOSED") throw new QuestError("Only a proposed quest can be put off.");
  await db
    .update(quests)
    .set({ deferredUntil: new Date(now.getTime() + policy.quests.defer_days * 86_400_000) })
    .where(eq(quests.id, q.id));
  await log(actor, "quest.defer", student.pseudonymousId, q.id);
}

/** Change the number of days for a quest, inside the range the policy allows (§9.1). */
export async function editQuestDays(
  student: { id: string; pseudonymousId: string },
  actor: Actor,
  questId: string,
  days: number,
  now = new Date(),
) {
  const policy = await getActivePolicy();
  const q = await own(student.id, questId);
  if (!["PROPOSED", "ACCEPTED", "ACTIVE"].includes(q.status))
    throw new QuestError("This quest can't be changed any more.");
  const targetDays = clampTargetDays(days, policy.llm.target_days_range);
  await db
    .update(quests)
    .set({ targetDays, ...(q.acceptedAt ? { dueAt: dueDate(q.acceptedAt, targetDays) } : {}) })
    .where(eq(quests.id, q.id));
  await log(actor, "quest.edit", student.pseudonymousId, q.id);
  return { targetDays, dueAt: q.acceptedAt ? dueDate(q.acceptedAt, targetDays) : null, now };
}

/** An expired quest can be picked up again with a fresh date; it was never held against the student. */
export async function reopenQuest(
  student: { id: string; pseudonymousId: string },
  actor: Actor,
  questId: string,
  now = new Date(),
) {
  const q = await own(student.id, questId);
  const next = nextQuestState(q.status, "reopen");
  if (!next) throw new QuestError("Only a quest that has passed its date can be picked up again.");
  await db
    .update(quests)
    .set({ status: next, acceptedAt: now, dueAt: dueDate(now, q.targetDays), expiredAt: null, statusNote: null })
    .where(eq(quests.id, q.id));
  await log(actor, "quest.reopen", student.pseudonymousId, q.id);
}

/**
 * Called whenever an artifact's status changes. If the artifact is a quest's evidence, a counted one of the
 * right type completes the quest; one that does not count sends it back to Active with the reason (§8.3).
 */
export async function settleQuestForArtifact(artifactId: string, now = new Date()) {
  const policy = await getActivePolicy();
  const [a] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
  if (!a) return null;
  const [q] = await db.select().from(quests).where(eq(quests.evidenceArtifactId, artifactId)).limit(1);
  if (!q || q.status !== "EVIDENCE_SUBMITTED") return null;
  // Only a confirmed item (verified by the system or attested by a reviewer) completes a quest. One still
  // waiting for a check or a reviewer changes nothing; one that was refused, or is the wrong thing, sends it back.
  const pending = ["SUBMITTED", "UNDER_CHECK", "SELF_REPORTED", "LIVE_UNVERIFIED"].includes(a.status);
  if (pending) return null;
  const check = evidenceCompletesQuest(q, a, policy);
  if (check.ok && ["VERIFIED", "ATTESTED"].includes(a.status)) {
    await db.update(quests).set({ status: "DONE", completedAt: now, statusNote: null }).where(eq(quests.id, q.id));
    // A new piece of evidence changes the score: re-score the student (§12.3 "refreshed when new evidence is added").
    await enqueue("evaluation", { studentId: q.studentId, requestedBy: "system", reason: "evidence_added" }).catch(
      (e) => logger.warn({ err: String(e) }, "could not queue re-evaluation after a quest was completed"),
    );
    return "DONE" as const;
  }
  const reason = check.ok
    ? `The evidence is ${a.status.replace("_", " ").toLowerCase()}, so it does not count yet`
    : check.reason;
  await db.update(quests).set({ status: "ACTIVE", statusNote: reason }).where(eq(quests.id, q.id));
  return "ACTIVE" as const;
}

/** The campus platform reports a result (a timed assessment, an internal test): verified evidence recorded by the system. */
export async function recordPlatformResult(input: {
  studentId: string;
  type: string;
  component: string;
  standardItem?: string | null;
  label: string;
  details?: Record<string, unknown>;
}) {
  const policy = await getActivePolicy();
  const spec = policy.evidence_types[input.type];
  if (!spec || spec.mode !== "platform") throw new QuestError(`${input.type} is not a platform result`);
  const [a] = await db
    .insert(artifacts)
    .values({
      studentId: input.studentId,
      type: input.type,
      component: input.component,
      standardItem: input.standardItem ?? null,
      label: input.label,
      source: "platform",
      status: "SUBMITTED",
      weight: spec.weight,
      details: input.details ?? {},
    })
    .returning();
  const { applyTransition } = await import("../verification/apply");
  await applyTransition(a.id, "UNDER_CHECK", { kind: "system" }, "Result received from the campus platform");
  await applyTransition(a.id, "VERIFIED", { kind: "system" }, "Generated and scored by the campus platform");
  // A platform result completes the matching accepted quest without the student submitting anything.
  const waiting = await db
    .select()
    .from(quests)
    .where(
      and(
        eq(quests.studentId, input.studentId),
        eq(quests.requiredEvidenceType, input.type),
        inArray(quests.status, ["ACCEPTED", "ACTIVE"]),
        input.standardItem
          ? eq(quests.standardItem, input.standardItem)
          : or(isNull(quests.standardItem), eq(quests.standardItem, "")),
      ),
    );
  for (const q of waiting) {
    await db.update(quests).set({ status: "EVIDENCE_SUBMITTED", evidenceArtifactId: a.id }).where(eq(quests.id, q.id));
    await settleQuestForArtifact(a.id);
  }
  return a;
}

/**
 * Quests that passed their date without evidence expire (§8.3), the mentor's card moves to Follow-up due
 * (or one is opened) and the mentor is told, in words that do not blame the student (§8.2).
 */
export async function expireDueQuests(now = new Date()): Promise<number> {
  const due = await db
    .select()
    .from(quests)
    .where(and(inArray(quests.status, ["ACCEPTED", "ACTIVE"]), lt(quests.dueAt, now)));
  let n = 0;
  for (const q of due) {
    if (!shouldExpire({ status: q.status as QuestState, dueAt: q.dueAt }, now)) continue;
    await db.update(quests).set({ status: "EXPIRED", expiredAt: now }).where(eq(quests.id, q.id));
    const [s] = await db
      .select({ id: students.id, pseudo: students.pseudonymousId })
      .from(students)
      .where(eq(students.id, q.studentId))
      .limit(1);
    const mentor = await mentorOf(q.studentId);
    if (mentor) {
      const card = await ensureCard(q.studentId, null, "FOLLOW_UP_DUE");
      if (card)
        await moveCardAsSystem(card.id, "FOLLOW_UP_DUE", `Quest “${q.title}” reached its date without evidence`);
      await notify({
        to: { userId: mentor },
        studentId: q.studentId,
        template: "quest_expired",
        vars: { quest: q.title },
        related: { type: "quest", id: q.id },
      });
    }
    await notify({
      to: { role: "student" },
      studentId: q.studentId,
      template: "quest_expired_student",
      vars: { quest: q.title },
      related: { type: "quest", id: q.id },
    });
    await audit({
      actorUserId: "system",
      actorRole: "system",
      action: "quest.expire",
      entityType: "quest",
      entityId: q.id,
      purpose: "quest_lifecycle",
      fieldsAccessed: [s?.pseudo ?? q.studentId],
      result: "allowed",
    });
    n++;
  }
  return n;
}
