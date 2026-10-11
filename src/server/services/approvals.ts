/** Approval queue (§8.1, §12.2). Nothing reaches a student without a decision. */
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { audit } from "../audit/log";
import { CONSENT_RECIPIENTS } from "../consent/matrix";
import { db } from "../db";
import { evaluations, interventions, staffAssignments, students } from "../db/schema";
import type { Role } from "../db/schema/enums";
import { getActivePolicy } from "../policy/load";
import { hasConsent } from "./consent";
import { addWorkingDays } from "./time";

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
  if (!updated) throw new Error("Concurrent update — please reload");

  // Consent check at dispatch (§8.1, §13.1): only attempt dispatch when approved.
  let dispatchResult: { dispatched: boolean; reason: string | null } | null = null;
  if (updated.status === "APPROVED") {
    dispatchResult = await attemptDispatch(updated, user.id);
    if (dispatchResult.dispatched) {
      updated.status = "DISPATCHED";
    }
  }
  return { ...updated, dispatchResult };
}

/**
 * Checks whether the student has consented to share records with the
 * intervention's recipient role (if the recipient is in CONSENT_RECIPIENTS per §13.1).
 * If consented or an academic role, advances the intervention to DISPATCHED.
 * If consent is missing, leaves it at APPROVED and records an audit event explaining the block.
 *
 * Called after every approve/edit-approve decision and by the SLA escalation
 * worker when consent is later granted.
 */
export async function attemptDispatch(
  row: typeof interventions.$inferSelect,
  actorUserId: string,
): Promise<{ dispatched: boolean; reason: string | null }> {
  const recipientRole = row.recipientRole as Role;

  // Academic roles (assigned faculty mentor, class advisor) have an established academic relationship (§12.1 card 2).
  // Consent is required when dispatching to external/placement/co-curricular roles (Table 13.1, CONSENT_RECIPIENTS).
  const isConsentRequiredRole = (CONSENT_RECIPIENTS as readonly Role[]).includes(recipientRole);
  if (isConsentRequiredRole) {
    const consented =
      (await hasConsent(row.studentId, "intervention_history", recipientRole)) ||
      (await hasConsent(row.studentId, "persona_aeg", recipientRole));

    if (!consented) {
      await audit({
        actorUserId,
        actorRole: "system",
        action: "intervention.dispatch_blocked",
        entityType: "intervention",
        entityId: row.id,
        purpose: "consent_check",
        result: "denied",
      });
      return {
        dispatched: false,
        reason: `Student has not consented to share records with ${recipientRole.replace("_", " ")}`,
      };
    }
  }

  await db
    .update(interventions)
    .set({ status: "DISPATCHED" })
    .where(and(eq(interventions.id, row.id), eq(interventions.status, "APPROVED")));

  await audit({
    actorUserId,
    actorRole: "system",
    action: "intervention.dispatched",
    entityType: "intervention",
    entityId: row.id,
    purpose: "dispatch",
    result: "allowed",
  });
  return { dispatched: true, reason: null };
}

/**
 * SLA escalation (§8.1). Called by the maintenance worker on a schedule.
 * For each APPROVED intervention whose SLA due date has passed and which has
 * a configured escalation route, creates a new PENDING_APPROVAL intervention
 * to the escalation role.
 */
export async function runSlaEscalation(): Promise<{ escalated: number }> {
  const policy = getActivePolicy();
  const now = new Date();

  // Find APPROVED interventions that are overdue.
  const overdue = await db
    .select()
    .from(interventions)
    .where(and(eq(interventions.status, "APPROVED"), lt(interventions.slaDueAt, now)));

  let escalated = 0;
  for (const row of overdue) {
    const route = policy.routes[row.routeKey];
    if (!route) continue;
    const escalateTo = route.escalate_to as Role | null;
    const escalateAfter = route.escalate_after_working_days;
    if (!escalateTo || escalateAfter == null) continue;

    // Check if enough working days have passed since slaDueAt.
    const escalationDate = addWorkingDays(row.slaDueAt, escalateAfter, policy.calendar.holidays);
    if (now < escalationDate) continue;

    // Don't double-escalate: check if an escalation already exists.
    const existing = await db
      .select({ id: interventions.id })
      .from(interventions)
      .where(
        and(
          eq(interventions.studentId, row.studentId),
          eq(interventions.routeKey, `${row.routeKey}_escalated`),
          eq(interventions.approverRole, escalateTo),
        ),
      )
      .limit(1);
    if (existing.length) continue;

    // Create the escalated intervention.
    const newSlaDue = addWorkingDays(now, route.sla_working_days, policy.calendar.holidays);
    await db.insert(interventions).values({
      evaluationId: row.evaluationId,
      studentId: row.studentId,
      routeKey: `${row.routeKey}_escalated`,
      recipientRole: escalateTo,
      approverRole: escalateTo,
      copyRoles: [],
      status: "PENDING_APPROVAL",
      queued: false,
      proposedMessage: row.finalMessage ?? row.proposedMessage,
      closureRule: route.closure,
      slaDueAt: newSlaDue,
    });
    await audit({
      actorUserId: "system",
      actorRole: "system",
      action: "intervention.escalated",
      entityType: "intervention",
      entityId: row.id,
      purpose: "sla_escalation",
      result: "allowed",
    });
    escalated++;
  }
  return { escalated };
}
