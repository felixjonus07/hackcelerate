"use server";
/**
 * Student server actions. Each one re-authorizes and acts only on the
 * authenticated student's record (§11: identifiers in the path are ignored).
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/server/audit/log";
import { requireStudent } from "@/server/auth/session";
import { CONSENT_RECIPIENTS, CONSENTABLE } from "@/server/consent/matrix";
import { db } from "@/server/db";
import { artifacts, aspirations, leaderboardOptIns, quests, students } from "@/server/db/schema";
import type { ConsentCategory, Role } from "@/server/db/schema/enums";
import { TRACK_IDS } from "@/server/policy/schema";
import { enqueue } from "@/server/queue";
import { setConsent } from "@/server/services/consent";
import { runEvaluation } from "@/server/services/evaluations";

export async function acceptQuest(questId: string) {
  const { student } = await requireStudent();
  await db
    .update(quests)
    .set({ status: "ACCEPTED", dueAt: new Date(Date.now() + 14 * 86_400_000) })
    .where(and(eq(quests.id, questId), eq(quests.studentId, student.id), eq(quests.status, "PROPOSED")));
  revalidatePath("/student", "layout");
}

export async function deferQuest(questId: string) {
  const { student } = await requireStudent();
  await db
    .update(quests)
    .set({ status: "EXPIRED" })
    .where(and(eq(quests.id, questId), eq(quests.studentId, student.id), eq(quests.status, "PROPOSED")));
  revalidatePath("/student", "layout");
}

const evidenceInput = z.object({
  questId: z.uuid(),
  sourceUrl: z.url().max(500),
  description: z.string().max(1000).optional(),
});

export async function submitQuestEvidence(_: unknown, form: FormData): Promise<{ ok: boolean; message: string }> {
  const { user, student } = await requireStudent();
  const parsed = evidenceInput.safeParse({
    questId: form.get("questId"),
    sourceUrl: form.get("sourceUrl"),
    description: form.get("description") || undefined,
  });
  if (!parsed.success) return { ok: false, message: "Add a full link starting with https://" };
  const [q] = await db
    .select()
    .from(quests)
    .where(and(eq(quests.id, parsed.data.questId), eq(quests.studentId, student.id)))
    .limit(1);
  if (!q) return { ok: false, message: "That quest isn't on your list any more." };
  const [a] = await db
    .insert(artifacts)
    .values({
      studentId: student.id,
      type: q.requiredEvidenceType,
      component: q.componentKey ?? "general",
      standardItem: q.standardItem,
      label: q.title,
      description: parsed.data.description ?? null,
      sourceUrl: parsed.data.sourceUrl,
      source: "student",
      status: "SUBMITTED",
    })
    .returning();
  await db.update(quests).set({ status: "EVIDENCE_SUBMITTED", evidenceArtifactId: a.id }).where(eq(quests.id, q.id));
  await enqueue("verification", {
    artifactId: a.id,
    kind: /github\.com/.test(parsed.data.sourceUrl)
      ? "github"
      : /doi\.org/.test(parsed.data.sourceUrl)
        ? "crossref"
        : "link",
  }).catch(() => null);
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "artifact.submit",
    entityType: "artifact",
    entityId: a.id,
    purpose: "quest_evidence",
    result: "allowed",
  });
  revalidatePath("/student", "layout");
  return {
    ok: true,
    message: "Submitted. We'll check it and update its status here.",
  };
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

export async function acknowledgeNotice() {
  const { user, student } = await requireStudent();
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "notice.ack",
    entityType: "student",
    entityId: student.pseudonymousId,
    purpose: "onboarding",
    result: "allowed",
  });
}

const generalEvidenceInput = z.object({
  label: z.string().min(3).max(200),
  sourceUrl: z.string().url().max(500),
  type: z.enum(["repository", "doi", "portfolio", "certificate", "letter"]).default("portfolio"),
  description: z.string().max(1000).optional(),
});

export async function submitGeneralEvidence(_: unknown, form: FormData): Promise<{ ok: boolean; message: string }> {
  const { user, student } = await requireStudent();
  const parsed = generalEvidenceInput.safeParse({
    label: form.get("label"),
    sourceUrl: form.get("sourceUrl"),
    type: form.get("type") || "portfolio",
    description: form.get("description") || undefined,
  });
  if (!parsed.success) return { ok: false, message: "Add a label and a full link starting with https://" };

  const [a] = await db
    .insert(artifacts)
    .values({
      studentId: student.id,
      type: parsed.data.type,
      component: "general",
      label: parsed.data.label,
      description: parsed.data.description ?? null,
      sourceUrl: parsed.data.sourceUrl,
      source: "student",
      status: "SUBMITTED",
    })
    .returning();

  await enqueue("verification", {
    artifactId: a.id,
    kind: /github\.com/.test(parsed.data.sourceUrl)
      ? "github"
      : /doi\.org/.test(parsed.data.sourceUrl)
        ? "crossref"
        : "link",
  }).catch(() => null);

  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "artifact.submit",
    entityType: "artifact",
    entityId: a.id,
    purpose: "onboarding_evidence",
    result: "allowed",
  });

  await runEvaluation(student.id, { actorUserId: user.id });
  revalidatePath("/student", "layout");
  return { ok: true, message: "Evidence submitted and queued for verification." };
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

import { submitRightsRequest } from "@/server/services/rights";

export async function requestRight(kind: "access" | "correction" | "erasure", detail?: string) {
  const { user, student } = await requireStudent();
  await submitRightsRequest(student.id, user.id, user.role, student.pseudonymousId, kind, detail);
  revalidatePath("/student/consent");
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
