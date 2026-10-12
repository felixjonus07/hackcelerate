/**
 * SLA escalation job (§8.1). Open proposals and approved routes are checked against their route's
 * escalation rule; when it trips, the next role is told. Escalation never decides for anyone, and a
 * role without individual access (dean, HOD, registrar) receives a count, not a student.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import {
  counselingCardMoves,
  counselingCards,
  integrityFlags,
  interventions,
  notifications,
  quests,
  students,
} from "../db/schema";
import { notify } from "../notifications";
import { getActivePolicy } from "../policy/load";
import { workingDaysBetween } from "../rules/calendar";
import { STARTED_STATES } from "../rules/quest";
import { escalationDecision } from "../rules/sla";

/** Roles that exist to receive escalations but have no login of their own in this build. */
const ROLE_FALLBACK: Record<string, string> = { program_coordinator: "hod" };
/** These roles see aggregates only (§13.1): their notice names the route and the department, not a student. */
const AGGREGATE_ONLY = new Set(["dean", "hod", "registrar", "auditor"]);

export async function runSlaEscalation(now = new Date()) {
  const policy = await getActivePolicy();
  const open = await db
    .select({ i: interventions, dept: students.departmentCode })
    .from(interventions)
    .innerJoin(students, eq(students.id, interventions.studentId))
    .where(
      and(
        inArray(interventions.status, ["PENDING_APPROVAL", "APPROVED", "DISPATCHED"]),
        isNull(interventions.escalatedAt),
      ),
    );

  let escalated = 0;
  for (const { i, dept } of open) {
    const route = policy.routes[i.routeKey];
    if (!route) continue;
    const started = await db
      .select({ id: quests.id })
      .from(quests)
      .where(and(eq(quests.studentId, i.studentId), inArray(quests.status, [...STARTED_STATES])))
      .limit(1);
    const met = await db
      .select({ id: counselingCardMoves.id })
      .from(counselingCardMoves)
      .innerJoin(counselingCards, eq(counselingCards.id, counselingCardMoves.cardId))
      .where(
        and(
          eq(counselingCards.studentId, i.studentId),
          inArray(counselingCardMoves.toColumn, ["IN_CONVERSATION", "PLAN_ACTIVE"]),
        ),
      )
      .limit(1);
    const d = escalationDecision({
      route,
      status: i.status,
      createdAt: i.createdAt,
      decidedAt: i.decidedAt,
      questStarted: started.length > 0,
      meetingLogged: met.length > 0,
      alreadyEscalated: false,
      now,
      calendar: policy.calendar,
    });
    if (!d.escalate) continue;
    const target = ROLE_FALLBACK[route.escalate_to] ?? route.escalate_to;
    await db.update(interventions).set({ escalatedAt: now, escalatedTo: target }).where(eq(interventions.id, i.id));
    await notify({
      to: { role: target },
      // Offices without individual access are told about the route and department only.
      studentId: AGGREGATE_ONLY.has(target) ? null : i.studentId,
      template: "route_escalated",
      vars: { route: route.label, department: dept, workingDays: d.workingDaysElapsed },
      related: { type: "intervention", id: i.id },
    });
    await audit({
      actorUserId: "system",
      actorRole: "system",
      action: "intervention.escalate",
      entityType: "intervention",
      entityId: i.id,
      purpose: "sla_escalation",
      reason: d.why,
      fieldsAccessed: [`to:${target}`],
      result: "allowed",
    });
    escalated++;
  }

  // Integrity flags unresolved past their route's window go to the program coordinator (§8.1).
  const flagRoute = policy.routes.integrity_flag;
  let flags = 0;
  if (flagRoute?.escalate_after_working_days != null) {
    const target = ROLE_FALLBACK[flagRoute.escalate_to] ?? flagRoute.escalate_to;
    const openFlags = await db.select().from(integrityFlags).where(eq(integrityFlags.status, "OPEN"));
    for (const f of openFlags) {
      if (workingDaysBetween(f.createdAt, now, policy.calendar) < flagRoute.escalate_after_working_days) continue;
      const done = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.relatedId, f.id), eq(notifications.template, "flag_escalated")))
        .limit(1);
      if (done.length) continue;
      await notify({
        to: { role: target },
        template: "flag_escalated",
        vars: { check: f.check },
        related: { type: "integrity_flag", id: f.id },
      });
      flags++;
    }
  }
  return { escalated, flags };
}
