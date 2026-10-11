/** Approval queue (§8.1, §12.2). Nothing reaches a student without a decision. */
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { auditMany } from "../audit/log";
import { CONSENT_RECIPIENTS } from "../consent/matrix";
import { db } from "../db";
import { evaluations, interventions, staffAssignments, students } from "../db/schema";
import type { Role } from "../db/schema/enums";
import { isErpStale } from "../ingestion/stale";
import { getActivePolicy } from "../policy/load";
import { workingDaysBetween } from "../rules/calendar";
import { consentedStudentIds } from "./consent";
import { type DispatchResult, dispatchIntervention } from "./dispatch";

export interface ApprovalRow {
  id: string;
  studentId: string;
  pseudonymousId: string;
  departmentCode: string;
  year: number;
  routeKey: string;
  recipientRole: Role;
  queued: boolean;
  proposedMessage: string;
  slaDueAt: Date;
  createdAt: Date;
  aegIndex: "LOW" | "MODERATE" | "CRITICAL";
  trend: string;
  trackScore: number;
  track: string;
  confidence: string;
  fallback: boolean;
  evaluationId: string;
  erpStale: boolean;
  /** Working days until the SLA is due, on the institution's calendar; negative when overdue (§8.1). */
  workingDaysLeft: number;
  /** When the last ERP import touched this student, and whether it is stale: a stale import can mislead an approver (§20.3). */
  erpImportedAt: Date | null;
}

export async function pendingApprovals(user: { id: string; role: Role }, now = new Date()): Promise<ApprovalRow[]> {
  const policy = await getActivePolicy();
  const assigned = db
    .select({ id: staffAssignments.studentId })
    .from(staffAssignments)
    .where(eq(staffAssignments.staffUserId, user.id));
  const rows = await db
    .select({
      id: interventions.id,
      studentId: students.id,
      pseudonymousId: students.pseudonymousId,
      departmentCode: students.departmentCode,
      year: students.year,
      routeKey: interventions.routeKey,
      recipientRole: interventions.recipientRole,
      queued: interventions.queued,
      proposedMessage: interventions.proposedMessage,
      slaDueAt: interventions.slaDueAt,
      createdAt: interventions.createdAt,
      aegIndex: evaluations.aegIndex,
      trend: evaluations.trend,
      trackScore: evaluations.trackScore,
      track: evaluations.track,
      confidence: evaluations.confidence,
      fallback: evaluations.fallback,
      evaluationId: evaluations.id,
      erpImportedAt: students.erpImportedAt,
      erpStale: students.erpStale,
    })
    .from(interventions)
    .innerJoin(students, eq(students.id, interventions.studentId))
    .innerJoin(evaluations, eq(evaluations.id, interventions.evaluationId))
    .where(
      and(
        eq(interventions.status, "PENDING_APPROVAL"),
        // The approver for the route, or the role it escalated to (§8.1), on their own students.
        or(eq(interventions.approverRole, user.role), eq(interventions.escalatedTo, user.role)),
        inArray(interventions.studentId, assigned),
      ),
    )
    .orderBy(asc(interventions.queued), asc(interventions.slaDueAt), desc(evaluations.aegIndex));

  // §13.1: a persona or gap flag reaches a placement, E-Cell or sports officer only with the student's consent.
  let visible = rows;
  if ((CONSENT_RECIPIENTS as readonly string[]).includes(user.role)) {
    const consented = await consentedStudentIds(
      rows.map((r) => r.studentId),
      "persona_aeg",
      user.role,
    );
    visible = rows.filter((r) => consented.has(r.studentId));
  }
  await auditMany(
    visible.map((r) => ({
      actorUserId: user.id,
      actorRole: user.role,
      action: "student_record.list_view",
      entityType: "student",
      entityId: r.pseudonymousId,
      purpose: "approval_queue",
      fieldsAccessed: ["intervention.proposal", "evaluation.summary"],
      result: "allowed" as const,
    })),
  );
  return visible.map((r) => ({
    ...r,
    workingDaysLeft: workingDaysBetween(now, r.slaDueAt, policy.calendar),
    erpStale: isErpStale({ erpStale: r.erpStale, erpImportedAt: r.erpImportedAt }, now, policy),
  }));
}

export type Decision = "approve" | "edit_approve" | "reject";

export async function decide(
  interventionId: string,
  user: { id: string; role: Role },
  decision: Decision,
  note: string | null,
  editedMessage: string | null,
): Promise<{ intervention: typeof interventions.$inferSelect; dispatch: DispatchResult | null }> {
  const [row] = await db.select().from(interventions).where(eq(interventions.id, interventionId)).limit(1);
  if (!row) throw new Error("Intervention not found");
  if (row.status !== "PENDING_APPROVAL") throw new Error("This proposal has already been decided");
  if (row.approverRole !== user.role && row.escalatedTo !== user.role)
    throw new Error("You are not the approver for this route");
  if (decision === "reject" && !note) throw new Error("A reason is required to reject");
  if (decision === "edit_approve" && !editedMessage?.trim())
    throw new Error("Write the edited message before approving");
  const [updated] = await db
    .update(interventions)
    .set({
      status: decision === "reject" ? "REJECTED" : "APPROVED",
      approverUserId: user.id,
      decisionNote: note,
      finalMessage: decision === "edit_approve" ? editedMessage : row.proposedMessage,
      decidedAt: new Date(),
    })
    .where(and(eq(interventions.id, interventionId), eq(interventions.status, "PENDING_APPROVAL")))
    .returning();
  if (!updated) throw new Error("This proposal has already been decided");
  // Approval is the human decision; the consent check then decides whether it can be sent (§8.1).
  const dispatch = decision === "reject" ? null : await dispatchIntervention(updated.id);
  return { intervention: updated, dispatch };
}
