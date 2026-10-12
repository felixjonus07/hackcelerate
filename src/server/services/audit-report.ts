/**
 * Aggregated audit report (§12.3 /admin/audit-report, NAAC / KPMG): cohort counts, the policy in force and its
 * history, and sampled records opened only with a logged reason (§13.1 auditor: "sample, with reason").
 * Aggregates never name a student; a sample shows provenance and evidence status, never a narrative or a persona.
 */
import { createHash } from "node:crypto";
import { desc, sql } from "drizzle-orm";
import { auditMany } from "../audit/log";
import { db } from "../db";
import { artifacts, auditEvents, evaluations, interventions, policyVersions, students } from "../db/schema";
import type { Role } from "../db/schema/enums";
import { getActivePolicyInfo } from "../policy/load";

export const AUDIT_REASONS = ["audit_request", "approval_decision", "scheduled_mentoring", "other"] as const;

export async function auditReport(opts: { department?: string } = {}) {
  const { policy, source } = await getActivePolicyInfo();
  const dept = opts.department;
  const scope = dept ? sql`student_id in (select id from students where department_code = ${dept})` : sql`true`;
  const [evalStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      fallback: sql<number>`count(*) filter (where fallback)::int`,
      students: sql<number>`count(distinct student_id)::int`,
      engineVersions: sql<string[]>`array_agg(distinct engine_version)`,
      policyVersions: sql<string[]>`array_agg(distinct policy_version)`,
    })
    .from(evaluations)
    .where(scope);
  const byIndex = await db
    .select({ level: evaluations.aegIndex, n: sql<number>`count(*)::int` })
    .from(evaluations)
    .where(scope)
    .groupBy(evaluations.aegIndex);
  const byStatus = await db
    .select({ status: interventions.status, n: sql<number>`count(*)::int` })
    .from(interventions)
    .where(scope)
    .groupBy(interventions.status);
  const evidenceByStatus = await db
    .select({ status: artifacts.status, n: sql<number>`count(*)::int` })
    .from(artifacts)
    .where(scope)
    .groupBy(artifacts.status);
  const recent = await db
    .select({ action: auditEvents.action, n: sql<number>`count(*)::int`, last: sql<Date>`max(${auditEvents.at})` })
    .from(auditEvents)
    .groupBy(auditEvents.action)
    .orderBy(desc(sql`count(*)`))
    .limit(10);
  const departments = await db
    .select({ code: students.departmentCode, n: sql<number>`count(*)::int` })
    .from(students)
    .groupBy(students.departmentCode)
    .orderBy(students.departmentCode);
  // §3.3: "the change appears in the next audit report".
  const policyHistory = await db
    .select({
      version: policyVersions.version,
      status: policyVersions.status,
      effectiveFrom: policyVersions.effectiveFrom,
      activatedAt: policyVersions.activatedAt,
      changed: policyVersions.changedSections,
      approvals: policyVersions.approvals,
      supersedes: policyVersions.supersedes,
    })
    .from(policyVersions)
    .orderBy(desc(policyVersions.effectiveFrom));
  return {
    policy: {
      version: policy.policy_version,
      status: policy.status,
      note: policy.status_note,
      source,
      provisional: policy.provisional,
    },
    department: dept ?? null,
    departments,
    evalStats,
    byIndex,
    byStatus,
    evidenceByStatus,
    recent,
    policyHistory,
    generatedAt: new Date(),
  };
}

export class SampleError extends Error {}

/**
 * A reproducible sample of evaluations for the auditor (§13.1): chosen by hashing each id with the policy
 * version and the month, so the same sample can be re-drawn. Each student read is logged with the reason.
 */
export async function sampleRecords(
  user: { id: string; role: Role },
  reason: string,
  note: string,
  count = 10,
  now = new Date(),
) {
  if (!(AUDIT_REASONS as readonly string[]).includes(reason)) throw new SampleError("Choose a reason from the list");
  if (reason === "other" && !note.trim()) throw new SampleError("Add a note for “other”");
  const { policy } = await getActivePolicyInfo();
  const seed = `${policy.policy_version}:${now.toISOString().slice(0, 7)}`;
  const rows = await db.execute<{
    id: string;
    student_id: string;
    handle: string;
    department: string;
    track: string;
    created_at: Date;
    policy_version: string;
    engine_version: string;
    model_version: string | null;
    prompt_version: string | null;
    input_hash: string;
    fallback: boolean;
    aeg_index: string;
  }>(sql`
    select distinct on (e.student_id) e.id, e.student_id, s.pseudonymous_id as handle, s.department_code as department,
           e.track, e.created_at, e.policy_version, e.engine_version, e.model_version, e.prompt_version, e.input_hash,
           e.fallback, e.aeg_index
    from evaluations e join students s on s.id = e.student_id
    order by e.student_id, e.created_at desc
  `);
  const sampled = [...rows]
    .map((r) => ({ r, key: sha(`${seed}:${r.id}`) }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, count)
    .map((x) => x.r);
  const evidence = sampled.length
    ? await db.select({ studentId: artifacts.studentId, status: artifacts.status }).from(artifacts)
    : [];
  await auditMany(
    sampled.map((r) => ({
      actorUserId: user.id,
      actorRole: user.role,
      action: "audit_report.sample",
      entityType: "student",
      entityId: r.handle,
      purpose: reason,
      reason: note || reason,
      fieldsAccessed: ["evaluation.provenance", "artifacts.status"],
      result: "allowed" as const,
    })),
  );
  return sampled.map((r) => {
    const counts: Record<string, number> = {};
    for (const a of evidence.filter((x) => x.studentId === r.student_id))
      counts[a.status] = (counts[a.status] ?? 0) + 1;
    return {
      handle: r.handle,
      department: r.department,
      track: r.track,
      evaluatedAt: r.created_at,
      policyVersion: r.policy_version,
      engineVersion: r.engine_version,
      model: r.model_version ? `${r.model_version} (${r.prompt_version})` : "rules only",
      inputHash: r.input_hash.slice(0, 12),
      fallback: r.fallback,
      evidence: counts,
    };
  });
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
