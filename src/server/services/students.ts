/**
 * Staff reads of an individual student (§12.2 mentor brief, §12.3 deep-dive).
 * Every read is authorized against the access matrix and audited (§13.6).
 */
import { and, desc, eq } from "drizzle-orm";
import { audit } from "../audit/log";
import { decideAccess } from "../consent/matrix";
import { db } from "../db";
import { artifacts, evaluations, interventions, staffAssignments, students } from "../db/schema";
import type { Role } from "../db/schema/enums";
import { getActivePolicy } from "../policy/load";

export class AccessDenied extends Error {}

async function isAssigned(staffUserId: string, studentId: string) {
  const rows = await db
    .select({ s: staffAssignments.studentId })
    .from(staffAssignments)
    .where(and(eq(staffAssignments.staffUserId, staffUserId), eq(staffAssignments.studentId, studentId)))
    .limit(1);
  return rows.length > 0;
}

export async function studentBrief(
  studentId: string,
  user: { id: string; role: Role },
  opts: { reasonCode?: string; purpose: string; sourceIp?: string | null },
) {
  const assigned = await isAssigned(user.id, studentId);
  const decision = decideAccess({
    role: user.role,
    category: "persona_aeg",
    isAssigned: assigned,
    reasonCode: opts.reasonCode,
    individual: true,
  });
  const [student] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "student_record.view",
    entityType: "student",
    entityId: student?.pseudonymousId ?? studentId,
    purpose: opts.reasonCode ?? opts.purpose,
    fieldsAccessed: ["evaluation.summary", "artifacts.status", "interventions.open"],
    sourceIp: opts.sourceIp,
    result: decision.allowed && student ? "allowed" : "denied",
  });
  if (!decision.allowed || !student) throw new AccessDenied(decision.reason);

  const narrativeAllowed = decideAccess({
    role: user.role,
    category: "evaluation_narrative",
    isAssigned: assigned,
    reasonCode: opts.reasonCode,
  }).allowed;
  const [evaluation] = await db
    .select()
    .from(evaluations)
    .where(eq(evaluations.studentId, studentId))
    .orderBy(desc(evaluations.createdAt))
    .limit(1);
  const history = await db
    .select({
      id: evaluations.id,
      createdAt: evaluations.createdAt,
      trackScore: evaluations.trackScore,
      aegIndex: evaluations.aegIndex,
      policyVersion: evaluations.policyVersion,
    })
    .from(evaluations)
    .where(eq(evaluations.studentId, studentId))
    .orderBy(desc(evaluations.createdAt))
    .limit(8);
  const evidence = decideAccess({
    role: user.role,
    category: "artifacts_evidence",
    isAssigned: assigned,
    reasonCode: opts.reasonCode,
  }).allowed
    ? await db.select().from(artifacts).where(eq(artifacts.studentId, studentId))
    : [];
  const open = await db
    .select()
    .from(interventions)
    .where(and(eq(interventions.studentId, studentId), eq(interventions.status, "PENDING_APPROVAL")));
  const policy = getActivePolicy();
  return {
    student,
    departmentName: policy.department_standards[student.departmentCode]?.name ?? student.departmentCode,
    evaluation: evaluation
      ? {
          ...evaluation,
          narrative: narrativeAllowed ? evaluation.narrative : null,
        }
      : null,
    history,
    evidence,
    openInterventions: open,
    assigned,
  };
}
