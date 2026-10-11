/**
 * SLA tracking and escalation (§8.1), as pure decisions. A route escalates when its condition still
 * holds after `escalate_after_working_days` on the institution's calendar. Escalation only tells another
 * role; it never decides anything on a person's behalf.
 */
import type { RouteRule } from "../policy/schema";
import { type Calendar, localDate, workingDaysBetween } from "./calendar";

export type InterventionState = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "DISPATCHED" | "CLOSED";

export interface EscalationInput {
  route: Pick<RouteRule, "escalate_after_working_days" | "escalation_condition">;
  status: InterventionState;
  createdAt: Date;
  /** When the approver decided (the clock for "after approval" conditions). */
  decidedAt: Date | null;
  questStarted: boolean;
  meetingLogged: boolean;
  alreadyEscalated: boolean;
  now: Date;
  calendar: Calendar;
}

export interface EscalationDecision {
  escalate: boolean;
  workingDaysElapsed: number;
  why: string;
}

export function escalationDecision(i: EscalationInput): EscalationDecision {
  const after = i.route.escalate_after_working_days;
  const none = (why: string, elapsed = 0): EscalationDecision => ({
    escalate: false,
    workingDaysElapsed: elapsed,
    why,
  });
  if (after == null) return none("This route does not escalate on time");
  if (i.alreadyEscalated) return none("Already escalated");
  if (i.status === "REJECTED" || i.status === "CLOSED") return none("Closed");

  switch (i.route.escalation_condition) {
    case "no_decision": {
      if (i.status !== "PENDING_APPROVAL") return none("A decision was made");
      const e = workingDaysBetween(i.createdAt, i.now, i.calendar);
      return { escalate: e >= after, workingDaysElapsed: e, why: `No decision after ${e} working days` };
    }
    case "no_quest_started": {
      if (i.status !== "APPROVED" && i.status !== "DISPATCHED") return none("Not approved yet");
      const e = workingDaysBetween(i.decidedAt ?? i.createdAt, i.now, i.calendar);
      return {
        escalate: e >= after && !i.questStarted,
        workingDaysElapsed: e,
        why: `No quest started ${e} working days after approval`,
      };
    }
    case "no_meeting": {
      if (i.status !== "APPROVED" && i.status !== "DISPATCHED") return none("Not approved yet");
      const e = workingDaysBetween(i.decidedAt ?? i.createdAt, i.now, i.calendar);
      return {
        escalate: e >= after && !i.meetingLogged,
        workingDaysElapsed: e,
        why: `No meeting logged ${e} working days after approval`,
      };
    }
    default:
      return none("Not tracked here");
  }
}

export type SlaState = "on_track" | "due_today" | "overdue";

/** Where an open proposal stands against its SLA, for the approval queue (§8.1). */
export function slaState(dueAt: Date, now: Date, calendar: Calendar): { state: SlaState; workingDaysLeft: number } {
  const left = workingDaysBetween(now, dueAt, calendar);
  if (left < 0) return { state: "overdue", workingDaysLeft: left };
  return {
    state: left === 0 || localDate(dueAt, calendar) === localDate(now, calendar) ? "due_today" : "on_track",
    workingDaysLeft: left,
  };
}
