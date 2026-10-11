/**
 * Intervention routing (§8.1). Every route starts as a proposal for the
 * approval queue; nothing is dispatched from here.
 */
import type { Policy } from "../policy/schema";
import type { PersonaMatch, RouteProposal } from "./types";

export function proposeRoutes(
  personas: PersonaMatch[],
  primary: string | null,
  attendanceCriticalFlag: boolean,
  policy: Policy,
): RouteProposal[] {
  const toProposal = (routeKey: string, queued: boolean): RouteProposal | null => {
    const r = policy.routes[routeKey];
    if (!r) return null;
    return {
      routeKey,
      label: r.label,
      recipientRole: r.recipient_role,
      approverRole: r.approver_role,
      copyRoles: r.copy_roles,
      slaWorkingDays: r.sla_working_days,
      closure: r.closure,
      queued,
    };
  };
  const ordered = policy.persona_precedence.filter((id) => personas.some((m) => m.persona === id));
  const routes = ordered.map((id) => toProposal(id, id !== primary)).filter((r): r is RouteProposal => r !== null);
  if (attendanceCriticalFlag) {
    const r = toProposal("attendance_critical", routes.length > 0);
    if (r) routes.push(r);
  }
  return routes;
}
