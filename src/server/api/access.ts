/**
 * Who may call each `/api/v1` endpoint (§11, Table 13.1). One list, read by the route handlers and by the
 * authorization tests, so a role can never be added to a route without showing up here. Client-safe.
 */
import { APPROVER_ROLES, COMMAND_CENTER_ROLES, STAFF_ROLES } from "../auth/roles";
import type { Role } from "../db/schema/enums";

export type Endpoint = {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  /** Path with `{param}` placeholders, as in §11. */
  path: string;
  /** Roles allowed; `"any"` means any signed-in user, with the check made on the record itself. */
  roles: readonly Role[] | "any";
  /** A sample body for a role that is allowed, so the call gets past the role check (validation errors are fine). */
  body?: unknown;
};

const STUDENT = ["student"] as const;

export const ENDPOINTS: readonly Endpoint[] = [
  { id: "passport", method: "GET", path: "/api/v1/students/me/passport", roles: STUDENT },
  { id: "aspiration", method: "PUT", path: "/api/v1/students/me/aspiration", roles: STUDENT, body: {} },
  { id: "consents", method: "GET", path: "/api/v1/students/me/consents", roles: STUDENT },
  {
    id: "consent",
    method: "PUT",
    path: "/api/v1/students/me/consents/{category}/{recipient}",
    roles: STUDENT,
    body: {},
  },
  { id: "what-if", method: "POST", path: "/api/v1/students/me/what-if", roles: STUDENT, body: {} },
  { id: "quests", method: "GET", path: "/api/v1/students/me/quests", roles: STUDENT },
  { id: "quest-evidence", method: "POST", path: "/api/v1/quests/{id}/evidence", roles: STUDENT, body: {} },
  { id: "export", method: "GET", path: "/api/v1/students/me/export", roles: STUDENT },
  {
    id: "leaderboard-visibility",
    method: "PUT",
    path: "/api/v1/students/me/leaderboard-visibility",
    roles: STUDENT,
    body: {},
  },
  { id: "cohorts", method: "GET", path: "/api/v1/cohorts", roles: COMMAND_CENTER_ROLES },
  { id: "student", method: "GET", path: "/api/v1/students/{id}", roles: STAFF_ROLES },
  { id: "evaluations", method: "POST", path: "/api/v1/evaluations", roles: ["faculty_mentor", "registrar"], body: {} },
  { id: "approvals", method: "GET", path: "/api/v1/approvals", roles: APPROVER_ROLES },
  { id: "decision", method: "POST", path: "/api/v1/interventions/{id}/decision", roles: APPROVER_ROLES, body: {} },
  { id: "card", method: "PATCH", path: "/api/v1/counseling/cards/{id}", roles: ["faculty_mentor"], body: {} },
  { id: "audit-report", method: "GET", path: "/api/v1/audit-report", roles: ["dean", "auditor", "hod"] },
  { id: "leaderboards", method: "GET", path: "/api/v1/leaderboards", roles: "any" },
  {
    id: "policy-list",
    method: "GET",
    path: "/api/v1/admin/policy/versions",
    roles: ["registrar", "dean", "hod", "auditor"],
  },
  { id: "policy-create", method: "POST", path: "/api/v1/admin/policy/versions", roles: ["registrar"], body: {} },
  {
    id: "policy-activate",
    method: "POST",
    path: "/api/v1/admin/policy/versions/{v}/activate",
    roles: ["registrar", "dean"],
    body: {},
  },
  { id: "ingestion", method: "GET", path: "/api/v1/admin/ingestion/status", roles: ["registrar"] },
  { id: "evidence-file", method: "GET", path: "/api/v1/evidence/{id}/file", roles: "any" },
];

/** The roles for an endpoint id, for `requireApiUser`. Throws on an unknown id so a typo fails loudly. */
export function rolesOf(id: string): readonly Role[] | undefined {
  const e = ENDPOINTS.find((x) => x.id === id);
  if (!e) throw new Error(`Unknown endpoint ${id}`);
  return e.roles === "any" ? undefined : e.roles;
}
