"use server";
/**
 * Student server actions. Each one re-authorizes and acts only on the
 * authenticated student's record (§11: identifiers in the path are ignored).
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { audit } from "@/server/audit/log";
import { requireStudent } from "@/server/auth/session";
import { CONSENT_RECIPIENTS, CONSENTABLE } from "@/server/consent/matrix";
import { db } from "@/server/db";
import { aspirations, leaderboardOptIns, quests, students } from "@/server/db/schema";
import type { ConsentCategory, Role } from "@/server/db/schema/enums";
import { TRACK_IDS } from "@/server/policy/schema";
import { setConsent } from "@/server/services/consent";
import { runEvaluation } from "@/server/services/evaluations";
import { EvidenceError, submitEvidence } from "@/server/services/evidence";
import { acknowledgeNotice, completeOnboarding, moveToCard, OnboardingError } from "@/server/services/onboarding";
import * as quests_ from "@/server/services/quests";
import { QuestError } from "@/server/services/quests";
import { RightsError, raiseRequest } from "@/server/services/rights";
import { dismissNudge } from "@/server/services/wellbeing";

type QuestResult = { ok: boolean; message: string };

/** Run a quest change for the signed-in student; a QuestError becomes a message, not a crash. */
async function questAction(
  fn: (ctx: Awaited<ReturnType<typeof requireStudent>>) => Promise<unknown>,
  done: string,
): Promise<QuestResult> {
  const ctx = await requireStudent();
  try {
    await fn(ctx);
  } catch (e) {
    if (e instanceof QuestError) return { ok: false, message: e.message };
    throw e;
  }
  revalidatePath("/student", "layout");
  return { ok: true, message: done };
}

export async function acceptQuest(questId: string) {
  return questAction(
    ({ user, student }) => quests_.acceptQuest(student, user, z.uuid().parse(questId)),
    "Accepted. The clock starts now.",
  );
}
export async function startQuest(questId: string) {
  return questAction(
    ({ user, student }) => quests_.startQuest(student, user, z.uuid().parse(questId)),
    "Marked as started.",
  );
}
export async function deferQuest(questId: string) {
  return questAction(
    ({ user, student }) => quests_.deferQuest(student, user, z.uuid().parse(questId)),
    "Put off. It will come back later.",
  );
}
export async function editQuestDays(questId: string, days: number) {
  return questAction(
    ({ user, student }) => quests_.editQuestDays(student, user, z.uuid().parse(questId), z.number().int().parse(days)),
    "Updated.",
  );
}
export async function reopenQuest(questId: string) {
  return questAction(
    ({ user, student }) => quests_.reopenQuest(student, user, z.uuid().parse(questId)),
    "Picked up again with a fresh date.",
  );
}

const evidenceInput = z.object({
  questId: z.uuid(),
  sourceUrl: z.string().max(500).optional(),
  description: z.string().max(1000).optional(),
});

export async function submitQuestEvidence(_: unknown, form: FormData): Promise<{ ok: boolean; message: string }> {
  const { user, student } = await requireStudent();
  const parsed = evidenceInput.safeParse({
    questId: form.get("questId"),
    sourceUrl: form.get("sourceUrl") || undefined,
    description: form.get("description") || undefined,
  });
  if (!parsed.success) return { ok: false, message: "Something in the form is missing. Reload and try again." };
  const [q] = await db
    .select()
    .from(quests)
    .where(and(eq(quests.id, parsed.data.questId), eq(quests.studentId, student.id)))
    .limit(1);
  if (!q) return { ok: false, message: "That quest isn't on your list any more." };
  const file = form.get("file");
  try {
    await submitEvidence(
      student,
      user,
      {
        type: q.requiredEvidenceType,
        label: q.title,
        component: q.componentKey ?? "general",
        standardItem: q.standardItem,
        sourceUrl: parsed.data.sourceUrl,
        description: parsed.data.description,
        file:
          file instanceof File && file.size > 0
            ? { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type }
            : null,
        questId: q.id,
      },
      (await headers()).get("x-forwarded-for"),
    );
  } catch (e) {
    if (e instanceof EvidenceError) return { ok: false, message: e.message };
    throw e;
  }
  revalidatePath("/student", "layout");
  return { ok: true, message: "Submitted. We'll check it and update its status here." };
}

const consentInput = z.object({
  category: z.enum(Object.keys(CONSENTABLE) as [ConsentCategory, ...ConsentCategory[]]),
  recipient: z.enum(CONSENT_RECIPIENTS),
  granted: z.boolean(),
});

export async function updateConsent(input: z.infer<typeof consentInput>) {
  const { user, student } = await requireStudent();
  const c = consentInput.parse(input);
  await setConsent(student.id, c.category, c.recipient as Role, c.granted, user.id);
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: c.granted ? "consent.grant" : "consent.withdraw",
    entityType: "student",
    entityId: student.pseudonymousId,
    purpose: "consent_center",
    fieldsAccessed: [`${c.category}:${c.recipient}`],
    result: "allowed",
  });
  revalidatePath("/student/consent");
}

export async function setLeaderboardVisibility(optedIn: boolean) {
  const { student } = await requireStudent();
  await db
    .insert(leaderboardOptIns)
    .values({ studentId: student.id, optedIn })
    .onConflictDoUpdate({
      target: leaderboardOptIns.studentId,
      set: { optedIn, changedAt: new Date() },
    });
  revalidatePath("/student/consent");
}

export async function requestRight(
  kind: "access" | "correction" | "erasure",
  detail?: string,
): Promise<{ ok: boolean; message: string; letter?: string | null }> {
  const { user, student } = await requireStudent();
  try {
    const r = await raiseRequest(student, user, { kind, detail: detail?.slice(0, 1000) });
    revalidatePath("/student/consent");
    return {
      ok: true,
      message:
        kind === "access"
          ? "Your export is ready. Download it below."
          : kind === "correction"
            ? "Sent. The registrar will check it and reply here."
            : "Received. The letter below says what is erased now and what is kept, and why.",
      letter: r.letter,
    };
  } catch (e) {
    if (e instanceof RightsError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Onboarding cards 1 and 6 (§12.1): the notice is acknowledged, then the setup is finished. */
export async function acknowledgeNoticeAction(): Promise<{ ok: boolean; message: string }> {
  const { user, student } = await requireStudent();
  await acknowledgeNotice(student, user);
  return { ok: true, message: "Noted." };
}

export async function moveToCardAction(card: number): Promise<void> {
  const { student } = await requireStudent();
  await moveToCard(student, z.number().int().min(0).max(5).parse(card));
}

export async function completeOnboardingAction(): Promise<{ ok: boolean; message: string }> {
  const { user, student } = await requireStudent();
  try {
    await completeOnboarding(student, user);
  } catch (e) {
    if (e instanceof OnboardingError) return { ok: false, message: e.message };
    throw e;
  }
  revalidatePath("/student", "layout");
  return { ok: true, message: "All set." };
}

const aspirationInput = z.object({
  track: z.enum(TRACK_IDS),
  targetOutcome: z.string().min(3).max(200),
  targetDate: z.iso.date().refine((d) => new Date(d) > new Date(), "Pick a date in the future"),
  readiness: z.coerce.number().int().min(40).max(100),
  reason: z.string().max(300).optional(),
});

export async function saveAspiration(_: unknown, form: FormData): Promise<{ ok: boolean; message: string }> {
  const { user, student } = await requireStudent();
  const parsed = aspirationInput.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check the highlighted fields",
    };
  const a = parsed.data;
  await db.transaction(async (tx) => {
    await tx
      .update(aspirations)
      .set({ isCurrent: false })
      .where(and(eq(aspirations.studentId, student.id), eq(aspirations.isCurrent, true)));
    await tx.insert(aspirations).values({
      studentId: student.id,
      track: a.track,
      targetOutcome: a.targetOutcome,
      targetDate: a.targetDate,
      readiness: a.readiness,
      changeReason: a.reason ?? null,
    });
    await tx.update(students).set({ declaredTrack: a.track }).where(eq(students.id, student.id));
  });
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "aspiration.change",
    entityType: "student",
    entityId: student.pseudonymousId,
    purpose: "onboarding",
    result: "allowed",
  });
  await runEvaluation(student.id, { actorUserId: user.id });
  revalidatePath("/student", "layout");
  return { ok: true, message: "Saved. Your passport has been re-scored." };
}

export async function dismissNudgeAction(nudgeId: string) {
  const { student } = await requireStudent();
  await dismissNudge(student.id, z.uuid().parse(nudgeId));
  revalidatePath("/student", "layout");
}
