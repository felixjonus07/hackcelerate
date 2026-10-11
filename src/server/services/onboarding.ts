/**
 * Student onboarding (§12.1): six cards — notice, consent choices, baseline check, ambition, evidence,
 * passport and quests. The server remembers the notice acknowledgement and the card the student is on, and
 * lets them finish only once the notice is acknowledged and an ambition is saved.
 */
import { and, eq, sql } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import { artifacts, aspirations, noticeAcknowledgements, students } from "../db/schema";
import { getActivePolicy } from "../policy/load";
import { latestEvaluation } from "./evaluations";

export const ONBOARDING_CARDS = 6;
export class OnboardingError extends Error {}

type Student = { id: string; pseudonymousId: string };
type Actor = { id: string; role: string };

export async function onboardingState(studentId: string) {
  const policy = await getActivePolicy();
  const [s] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  const [ack] = await db
    .select()
    .from(noticeAcknowledgements)
    .where(
      and(eq(noticeAcknowledgements.studentId, studentId), eq(noticeAcknowledgements.version, policy.notice.version)),
    )
    .limit(1);
  const [asp] = await db
    .select({ id: aspirations.id })
    .from(aspirations)
    .where(and(eq(aspirations.studentId, studentId), eq(aspirations.isCurrent, true)))
    .limit(1);
  const [{ n: evidence }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(artifacts)
    .where(and(eq(artifacts.studentId, studentId), eq(artifacts.source, "student")));
  const evaluation = await latestEvaluation(studentId);
  return {
    step: s?.onboardingStep ?? 0,
    onboardedAt: s?.onboardedAt ?? null,
    noticeVersion: policy.notice.version,
    noticeAcknowledged: Boolean(ack),
    hasAspiration: Boolean(asp),
    evidenceCount: evidence,
    hasEvaluation: Boolean(evaluation),
  };
}

async function advance(studentId: string, step: number) {
  await db
    .update(students)
    .set({ onboardingStep: sql`greatest(${students.onboardingStep}, ${Math.min(step, ONBOARDING_CARDS - 1)})` })
    .where(eq(students.id, studentId));
}

/** Card 1: the student reads and acknowledges the notice. No data is collected at this step (§12.1). */
export async function acknowledgeNotice(student: Student, actor: Actor) {
  const policy = await getActivePolicy();
  await db
    .insert(noticeAcknowledgements)
    .values({ studentId: student.id, version: policy.notice.version })
    .onConflictDoNothing();
  await advance(student.id, 1);
  await audit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "notice.acknowledge",
    entityType: "student",
    entityId: student.pseudonymousId,
    purpose: "onboarding",
    fieldsAccessed: [policy.notice.version],
    result: "allowed",
  });
}

export async function moveToCard(student: Student, card: number) {
  await advance(student.id, card);
}

/** Card 6: finish. Needs the notice acknowledged and an ambition saved (the first evaluation runs on save). */
export async function completeOnboarding(student: Student, actor: Actor, now = new Date()) {
  const state = await onboardingState(student.id);
  if (!state.noticeAcknowledged) throw new OnboardingError("Read and acknowledge the notice first.");
  if (!state.hasAspiration) throw new OnboardingError("Save your ambition so we can score your first passport.");
  await db
    .update(students)
    .set({ onboardedAt: state.onboardedAt ?? now, onboardingStep: ONBOARDING_CARDS - 1 })
    .where(eq(students.id, student.id));
  await audit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "onboarding.complete",
    entityType: "student",
    entityId: student.pseudonymousId,
    purpose: "onboarding",
    result: "allowed",
  });
}
