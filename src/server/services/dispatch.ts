/**
 * Dispatch (§8.1, §13.1): an approved intervention is sent only after a consent check on every office
 * that would receive it. When consent is missing it is blocked and explained to the approver; nothing
 * is sent, and it goes out by itself if the student later shares what the route carries.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { audit } from "../audit/log";
import { type ConsentGap, consentGaps, explainGaps } from "../consent/dispatch";
import { db } from "../db";
import { interventions } from "../db/schema";
import { notify } from "../notifications";
import { getActivePolicy } from "../policy/load";
import { shadowMode } from "../shadow";
import { currentConsents } from "./consent";
import { ensureCard } from "./counseling";
import { parentalState } from "./parental";

export type DispatchResult =
  | { status: "DISPATCHED"; gaps: [] }
  | { status: "BLOCKED"; gaps: ConsentGap[]; message: string }
  | { status: "SKIPPED"; gaps: []; message: string };

export async function dispatchIntervention(interventionId: string, now = new Date()): Promise<DispatchResult> {
  const policy = await getActivePolicy();
  const [row] = await db.select().from(interventions).where(eq(interventions.id, interventionId)).limit(1);
  if (!row || row.status !== "APPROVED")
    return { status: "SKIPPED", gaps: [], message: "Only an approved proposal can be sent" };
  // Shadow mode (§16.2): the system scores and proposes, but nothing reaches a student or an office.
  if (shadowMode) return { status: "SKIPPED", gaps: [], message: "Shadow mode is on, so nothing is sent" };
  const route = policy.routes[row.routeKey];
  if (!route) return { status: "SKIPPED", gaps: [], message: `No route ${row.routeKey} in the policy` };

  // A student under 18 is not contacted before a guardian's consent is verified (§13.4).
  const parental = await parentalState(row.studentId, now);
  if (parental.minor && parental.status !== "VERIFIED") {
    const message =
      "The student is under 18 and a guardian's consent has not been verified, so nothing was sent. The registrar records it.";
    await db.update(interventions).set({ dispatchBlockedReason: message }).where(eq(interventions.id, row.id));
    return { status: "BLOCKED", gaps: [], message };
  }
  const gaps = consentGaps(route, await currentConsents(row.studentId));
  if (gaps.length > 0) {
    const message = explainGaps(gaps);
    await db.update(interventions).set({ dispatchBlockedReason: message }).where(eq(interventions.id, row.id));
    await audit({
      actorUserId: row.approverUserId ?? "system",
      actorRole: row.approverRole,
      action: "intervention.dispatch_blocked",
      entityType: "intervention",
      entityId: row.id,
      purpose: "consent_check",
      reason: message,
      fieldsAccessed: gaps.map((g) => `${g.category}:${g.role}`),
      result: "denied",
    });
    if (row.approverUserId)
      await notify({
        to: { userId: row.approverUserId },
        studentId: row.studentId,
        template: "dispatch_blocked",
        vars: { route: route.label },
        related: { type: "intervention", id: row.id },
      });
    return { status: "BLOCKED", gaps, message };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(interventions)
      .set({ status: "DISPATCHED", dispatchedAt: now, dispatchBlockedReason: null })
      .where(eq(interventions.id, row.id));
    const message = row.finalMessage ?? row.proposedMessage;
    // The student hears it from the approved wording only, and the people who act on it are told too.
    await notify(
      {
        to: { role: "student" },
        studentId: row.studentId,
        template: "intervention_message",
        vars: { message, route: route.label },
        related: { type: "intervention", id: row.id },
      },
      tx,
    );
    await notify(
      {
        to: { role: row.recipientRole },
        studentId: row.studentId,
        template: "intervention_for_you",
        vars: { route: route.label },
        related: { type: "intervention", id: row.id },
      },
      tx,
    );
    for (const copy of route.copy_roles)
      await notify(
        // Copy roles get the summary the student agreed to share, never the full record.
        {
          to: { role: copy },
          studentId: row.studentId,
          template: "intervention_copy",
          vars: { route: route.label, shared: route.shares.join(", ") || "summary" },
          related: { type: "intervention", id: row.id },
        },
        tx,
      );
  });
  // §8.2: one card per student with a route in progress.
  await ensureCard(row.studentId, row.id);
  await audit({
    actorUserId: row.approverUserId ?? "system",
    actorRole: row.approverRole,
    action: "intervention.dispatch",
    entityType: "intervention",
    entityId: row.id,
    purpose: "approval_decision",
    fieldsAccessed: [row.recipientRole, ...route.copy_roles],
    result: "allowed",
  });
  return { status: "DISPATCHED", gaps: [] };
}

/** A student shared something new: send what was waiting on that consent. */
export async function retryBlockedDispatches(studentId: string, now = new Date()) {
  const waiting = await db
    .select({ id: interventions.id })
    .from(interventions)
    .where(
      and(
        eq(interventions.studentId, studentId),
        eq(interventions.status, "APPROVED"),
        isNotNull(interventions.dispatchBlockedReason),
      ),
    );
  const out: DispatchResult[] = [];
  for (const w of waiting) out.push(await dispatchIntervention(w.id, now));
  return out;
}
