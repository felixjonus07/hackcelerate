/**
 * Runs one evaluation end to end (§10.2): facts → rules engine → narrative →
 * immutable evaluation row → interventions (PENDING_APPROVAL) and quests.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { departments, evaluations, interventions, quests, remediationLibrary, students } from "../db/schema";
import type { Role } from "../db/schema/enums";
import { generateNarrative } from "../llm/narrative";
import { getActivePolicy } from "../policy/load";
import { evaluate } from "../rules";
import { loadStudentFacts } from "./facts";
import { addWorkingDays } from "./time";

export async function runEvaluation(studentId: string, opts: { actorUserId?: string; now?: Date } = {}) {
  const policy = getActivePolicy();
  const now = opts.now ?? new Date();
  const facts = await loadStudentFacts(studentId);
  const result = evaluate(facts, policy);
  const [student] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  const [dept] = await db.select().from(departments).where(eq(departments.code, student.departmentCode)).limit(1);

  // Remediation items for the largest weighted gaps (pgvector ranking is Phase 1).
  const gapComponents = result.trackScore.components
    .filter((c) => c.dataGaps.length > 0 || c.score < 60)
    .sort((a, b) => b.weight * (100 - b.score) - a.weight * (100 - a.score))
    .map((c) => c.key);
  const remediation = gapComponents.length
    ? (
        await db
          .select()
          .from(remediationLibrary)
          .where(
            and(
              eq(remediationLibrary.track, result.trackScore.track),
              inArray(remediationLibrary.componentKey, gapComponents),
            ),
          )
      )
        .filter((r) => !r.departmentCode || r.departmentCode === student.departmentCode)
        .sort((a, b) => gapComponents.indexOf(a.componentKey) - gapComponents.indexOf(b.componentKey))
        .slice(0, 3)
    : [];

  const inputHash = createHash("sha256")
    .update(JSON.stringify([facts, policy.policy_version]))
    .digest("hex");
  const evaluationId = crypto.randomUUID();
  const narrative = await generateNarrative(
    {
      evaluationId,
      pseudonymousId: student.pseudonymousId,
      departmentName: dept?.name ?? student.departmentCode,
      evaluation: result,
      evidence: facts.evidence,
      remediation: remediation.map((r) => ({
        id: r.id,
        title: r.title,
        action: r.action,
        defaultTargetDays: r.defaultTargetDays,
      })),
    },
    policy,
  );

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(evaluations)
      .values({
        id: evaluationId,
        studentId,
        policyVersion: policy.policy_version,
        engineVersion: result.engineVersion,
        modelProvider: narrative.model?.provider ?? null,
        modelVersion: narrative.model?.model ?? null,
        promptVersion: narrative.model?.promptVersion ?? null,
        inputHash,
        track: result.trackScore.track,
        trackScore: result.trackScore.score,
        readiness: result.readiness,
        gapRatio: result.gapRatio,
        gapIndex: result.gapIndex,
        aegIndex: result.aegIndex,
        primaryPersona: result.primaryPersona,
        trend: result.trend.overall,
        confidence: result.trackScore.confidence,
        result,
        narrative: {
          ...narrative.narrative,
          removedSentences: narrative.removed,
          warnings: narrative.warnings,
        },
        fallback: narrative.fallback,
        createdBy: opts.actorUserId ?? null,
        createdAt: now,
      })
      .returning();

    // Supersede earlier pending proposals for this student, then propose anew.
    await tx
      .update(interventions)
      .set({
        status: "CLOSED",
        decisionNote: "Superseded by a newer evaluation",
        decidedAt: now,
      })
      .where(and(eq(interventions.studentId, studentId), eq(interventions.status, "PENDING_APPROVAL")));
    for (const r of result.routes) {
      await tx.insert(interventions).values({
        evaluationId: row.id,
        studentId,
        routeKey: r.routeKey,
        recipientRole: r.recipientRole as Role,
        approverRole: r.approverRole as Role,
        copyRoles: r.copyRoles,
        queued: r.queued,
        proposedMessage: narrative.narrative.prescriptive_action_plan[0]?.action ?? r.label,
        slaDueAt: addWorkingDays(now, r.slaWorkingDays, policy.calendar?.holidays),
        closureRule: r.closure,
      });
    }

    await tx.delete(quests).where(and(eq(quests.studentId, studentId), eq(quests.status, "PROPOSED")));
    for (const r of remediation) {
      await tx.insert(quests).values({
        studentId,
        evaluationId: row.id,
        title: r.title,
        action: r.action,
        targetDays: r.defaultTargetDays,
        requiredEvidenceType: r.requiredEvidenceType,
        componentKey: r.componentKey,
        standardItem: r.standardItem,
      });
    }
    return row;
  });
}

export async function latestEvaluation(studentId: string) {
  const [row] = await db
    .select()
    .from(evaluations)
    .where(eq(evaluations.studentId, studentId))
    .orderBy(desc(evaluations.createdAt))
    .limit(1);
  return row ?? null;
}
