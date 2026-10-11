/** Approval queue (§8.1, §12.2). Nothing reaches a student without a decision. */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { evaluations, interventions, staffAssignments, students } from "../db/schema";
import type { Role } from "../db/schema/enums";

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
}

export async function pendingApprovals(user: { id: string; role: Role }): Promise<ApprovalRow[]> {
  const assigned = db
    .select({ id: staffAssignments.studentId })
    .from(staffAssignments)
    .where(eq(staffAssignments.staffUserId, user.id));
  return db
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
    })
    .from(interventions)
    .innerJoin(students, eq(students.id, interventions.studentId))
    .innerJoin(evaluations, eq(evaluations.id, interventions.evaluationId))
    .where(
      and(
        eq(interventions.status, "PENDING_APPROVAL"),
        eq(interventions.approverRole, user.role),
        inArray(interventions.studentId, assigned),
      ),
    )
    .orderBy(asc(interventions.queued), asc(interventions.slaDueAt), desc(evaluations.aegIndex));
}

export type Decision = "approve" | "edit_approve" | "reject";

export async function decide(
  interventionId: string,
  user: { id: string; role: Role },
  decision: Decision,
  note: string | null,
  editedMessage: string | null,
) {
  const [row] = await db.select().from(interventions).where(eq(interventions.id, interventionId)).limit(1);
  if (!row) throw new Error("Intervention not found");
  if (row.status !== "PENDING_APPROVAL") throw new Error("This proposal has already been decided");
  if (row.approverRole !== user.role) throw new Error("You are not the approver for this route");
  if (decision === "reject" && !note) throw new Error("A reason is required to reject");
  // Phase 6: consent check at dispatch (recipient + category) before APPROVED → DISPATCHED.
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
  return updated;
}
