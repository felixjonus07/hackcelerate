/**
 * Retention jobs (§13.5) and erasure (§13.7). The schedule and its periods come from the policy. Rows in
 * append-only tables can be removed only inside a transaction that sets `aspiredge.allow_erasure`, which is
 * what the database triggers look for, and every run is audited with its counts.
 */
import { and, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import {
  artifacts,
  attendanceWeeks,
  auditEvents,
  cohortAggregates,
  counselingCards,
  evaluations,
  interventions,
  mockAttempts,
  quests,
  rightsRequests,
  students,
} from "../db/schema";
import type { Role } from "../db/schema/enums";
import { logger } from "../logger";
import { notify } from "../notifications";
import { getActivePolicy } from "../policy/load";
import { erasurePlan, retentionCutoffs } from "../rules/retention";
import { storage } from "../storage";

export interface RetentionReport {
  dryRun: boolean;
  attendanceWeeks: number;
  artifactFiles: number;
  rawAnswers: number;
  evaluations: number;
  evaluationsKept: number;
  aggregatesWritten: number;
  interventions: number;
  auditEventsArchived: number;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const allowErasure = (tx: Tx) => tx.execute(sql`set local aspiredge.allow_erasure = 'on'`);

export async function runRetention(now = new Date(), opts: { dryRun?: boolean } = {}): Promise<RetentionReport> {
  const policy = await getActivePolicy();
  const c = retentionCutoffs(policy, now);
  const dryRun = Boolean(opts.dryRun);
  const report: RetentionReport = {
    dryRun,
    attendanceWeeks: 0,
    artifactFiles: 0,
    rawAnswers: 0,
    evaluations: 0,
    evaluationsKept: 0,
    aggregatesWritten: 0,
    interventions: 0,
    auditEventsArchived: 0,
  };

  // ERP copies: the current academic year plus one, then replaced.
  const oldWeeks = await db
    .select({ id: attendanceWeeks.id })
    .from(attendanceWeeks)
    .where(lt(attendanceWeeks.weekStart, c.attendanceBefore));
  report.attendanceWeeks = oldWeeks.length;
  if (!dryRun && oldWeeks.length)
    await db.delete(attendanceWeeks).where(lt(attendanceWeeks.weekStart, c.attendanceBefore));

  // Uploaded certificates and letters: 90 days after verification. The verified outcome stays; the file goes.
  const files = await db
    .select({ id: artifacts.id, ref: artifacts.fileRef, details: artifacts.details })
    .from(artifacts)
    .where(
      and(
        isNotNull(artifacts.fileRef),
        or(
          lt(artifacts.verifiedAt, c.artifactFilesVerifiedBefore),
          lt(artifacts.attestedAt, c.artifactFilesVerifiedBefore),
        ),
      ),
    );
  report.artifactFiles = files.length;
  if (!dryRun)
    for (const f of files) {
      await storage.delete(f.ref as string);
      await db
        .update(artifacts)
        .set({ fileRef: null, details: { ...f.details, fileDeletedAt: now.toISOString() } })
        .where(eq(artifacts.id, f.id));
    }

  // Raw test answers: 12 months; scores and percentiles stay with the record.
  const raw = await db
    .select({ id: mockAttempts.id })
    .from(mockAttempts)
    .where(and(isNotNull(mockAttempts.rawAnswers), lt(mockAttempts.takenAt, c.rawAnswersBefore)));
  report.rawAnswers = raw.length;
  if (!dryRun && raw.length)
    await db
      .update(mockAttempts)
      .set({ rawAnswers: null })
      .where(and(isNotNull(mockAttempts.rawAnswers), lt(mockAttempts.takenAt, c.rawAnswersBefore)));

  // Interventions and approvals: three years after closure.
  const oldInterventions = await db
    .select({ id: interventions.id })
    .from(interventions)
    .where(
      and(
        inArray(interventions.status, ["CLOSED", "REJECTED"]),
        lt(
          sql`coalesce(${interventions.decidedAt}, ${interventions.createdAt})`,
          c.interventionsClosedBefore.toISOString() as never,
        ),
      ),
    );
  report.interventions = oldInterventions.length;
  if (!dryRun && oldInterventions.length) {
    const ids = oldInterventions.map((i) => i.id);
    await db.update(counselingCards).set({ interventionId: null }).where(inArray(counselingCards.interventionId, ids));
    await db.delete(interventions).where(inArray(interventions.id, ids));
  }

  // Evaluations and narratives: 12 months after graduation, keeping aggregate statistics.
  const graduates = await db
    .select({ id: students.id, dept: students.departmentCode })
    .from(students)
    .where(and(isNotNull(students.graduatedOn), lt(students.graduatedOn, c.graduatedBefore)));
  if (graduates.length) {
    const ids = graduates.map((g) => g.id);
    const evals = await db.select().from(evaluations).where(inArray(evaluations.studentId, ids));
    const referenced = new Set(
      (
        await db
          .select({ e: interventions.evaluationId })
          .from(interventions)
          .where(inArray(interventions.studentId, ids))
      ).map((r) => r.e),
    );
    const deletable = evals.filter((e) => !referenced.has(e.id)); // an evaluation behind a retained support record is kept with it
    report.evaluations = deletable.length;
    report.evaluationsKept = evals.length - deletable.length;
    if (!dryRun && deletable.length) {
      const latest = new Map<string, (typeof evals)[number]>();
      for (const e of evals)
        if (!latest.has(e.studentId) || e.createdAt > (latest.get(e.studentId) as (typeof evals)[number]).createdAt)
          latest.set(e.studentId, e);
      const groups = new Map<string, { dept: string; track: string; idx: string; scores: number[] }>();
      for (const e of latest.values()) {
        const dept = graduates.find((g) => g.id === e.studentId)?.dept ?? "?";
        const k = `${dept}|${e.track}|${e.aegIndex}`;
        const g = groups.get(k) ?? { dept, track: e.track, idx: e.aegIndex, scores: [] };
        g.scores.push(e.trackScore);
        groups.set(k, g);
      }
      await db.transaction(async (tx) => {
        await allowErasure(tx);
        const period = now.toISOString().slice(0, 7);
        for (const g of groups.values()) {
          await tx.insert(cohortAggregates).values({
            period,
            department: g.dept,
            track: g.track,
            aegIndex: g.idx,
            students: g.scores.length,
            meanScore: g.scores.reduce((a, b) => a + b, 0) / g.scores.length,
          });
          report.aggregatesWritten++;
        }
        const del = deletable.map((e) => e.id);
        await tx.update(quests).set({ evaluationId: null }).where(inArray(quests.evaluationId, del));
        await tx.delete(evaluations).where(inArray(evaluations.id, del));
      });
    }
  }

  // Audit events: seven years, then archived and restricted to auditors.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(lt(auditEvents.at, c.auditBefore));
  report.auditEventsArchived = n;
  if (!dryRun && n)
    await db.transaction(async (tx) => {
      await allowErasure(tx);
      await tx.execute(sql`insert into audit_events_archive (id, at, actor_user_id, actor_role, action, entity_type, entity_id, purpose, reason, fields_accessed, policy_version, source_ip, result)
        select id, at, actor_user_id, actor_role, action, entity_type, entity_id, purpose, reason, fields_accessed, policy_version, source_ip, result
        from audit_events where at < ${c.auditBefore.toISOString()}::timestamptz`);
      await tx.delete(auditEvents).where(lt(auditEvents.at, c.auditBefore));
    });

  await audit({
    actorUserId: "system",
    actorRole: "system",
    action: dryRun ? "retention.dry_run" : "retention.run",
    entityType: "retention",
    entityId: now.toISOString().slice(0, 10),
    purpose: "retention_schedule",
    fieldsAccessed: Object.entries(report)
      .filter(([k, v]) => typeof v === "number" && k !== "dryRun")
      .map(([k, v]) => `${k}:${v}`),
    result: "allowed",
  });
  logger.info({ ...report }, "retention run finished");
  return report;
}

export class ErasureError extends Error {}

/**
 * The registrar carries out an erasure request after reading the plan (§13.7). It erases what the schedule
 * lets go of and keeps the rest; the student gets the outcome in writing, including anything kept and why.
 */
export async function executeErasure(registrar: { id: string; role: Role }, requestId: string, now = new Date()) {
  if (registrar.role !== "registrar") throw new ErasureError("Only the registrar carries out an erasure");
  const policy = await getActivePolicy();
  const [r] = await db.select().from(rightsRequests).where(eq(rightsRequests.id, requestId)).limit(1);
  if (!r || r.kind !== "erasure" || !["OPEN", "IN_PROGRESS"].includes(r.status))
    throw new ErasureError("This is not an open erasure request");
  const open = await db
    .select({ id: interventions.id })
    .from(interventions)
    .where(
      and(eq(interventions.studentId, r.studentId), inArray(interventions.status, ["PENDING_APPROVAL", "APPROVED"])),
    )
    .limit(1);
  const plan = erasurePlan(policy, { hasOpenIntervention: open.length > 0 });
  const erase = new Set(plan.filter((l) => l.action === "erase_now").map((l) => l.key));
  const done: string[] = [];

  await db.transaction(async (tx) => {
    await allowErasure(tx);
    if (erase.has("erp_copies")) {
      await tx.delete(attendanceWeeks).where(eq(attendanceWeeks.studentId, r.studentId));
      await tx
        .update(students)
        .set({
          cgpa: null,
          attendancePct: null,
          activeBacklogs: 0,
          creditsHeld: null,
          dateOfBirth: null,
          erpImportedAt: null,
        })
        .where(eq(students.id, r.studentId));
      done.push("copies of your university records");
    }
    if (erase.has("artifact_files")) {
      const files = await tx
        .select({ id: artifacts.id, ref: artifacts.fileRef })
        .from(artifacts)
        .where(and(eq(artifacts.studentId, r.studentId), isNotNull(artifacts.fileRef)));
      for (const f of files) await storage.delete(f.ref as string);
      if (files.length)
        await tx.delete(artifacts).where(
          inArray(
            artifacts.id,
            files.map((f) => f.id),
          ),
        );
      done.push(`${files.length} uploaded file${files.length === 1 ? "" : "s"}`);
    }
    if (erase.has("mock_raw_answers")) {
      await tx.update(mockAttempts).set({ rawAnswers: null }).where(eq(mockAttempts.studentId, r.studentId));
      done.push("raw test answers");
    }
    if (erase.has("evaluations")) {
      const kept = new Set(
        (
          await tx
            .select({ e: interventions.evaluationId })
            .from(interventions)
            .where(eq(interventions.studentId, r.studentId))
        ).map((x) => x.e),
      );
      const all = await tx
        .select({ id: evaluations.id })
        .from(evaluations)
        .where(eq(evaluations.studentId, r.studentId));
      const del = all.filter((e) => !kept.has(e.id)).map((e) => e.id);
      if (del.length) {
        await tx.update(quests).set({ evaluationId: null }).where(inArray(quests.evaluationId, del));
        await tx.delete(evaluations).where(inArray(evaluations.id, del));
      }
      done.push(
        `${del.length} score${del.length === 1 ? "" : "s"} and summar${del.length === 1 ? "y" : "ies"}${all.length - del.length ? ` (${all.length - del.length} kept with the support records they belong to)` : ""}`,
      );
    }
  });

  const kept = plan.filter((l) => l.action === "keep").map((l) => `${l.label}: ${l.reason}`);
  const outcome = [
    `Erased: ${done.join("; ") || "nothing needed erasing"}.`,
    kept.length ? `Kept, and why: ${kept.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  await db
    .update(rightsRequests)
    .set({ status: "RESOLVED", resolution: outcome, resolvedAt: now, resolvedBy: registrar.id })
    .where(eq(rightsRequests.id, requestId));
  await audit({
    actorUserId: registrar.id,
    actorRole: registrar.role,
    action: "rights.erasure.execute",
    entityType: "rights_request",
    entityId: requestId,
    purpose: "rights_request",
    reason: outcome,
    fieldsAccessed: [...erase],
    result: "allowed",
  });
  await notify({
    to: { role: "student" },
    studentId: r.studentId,
    template: "rights_resolved",
    vars: { kind: "erasure" },
  });
  return { outcome, erased: done };
}
