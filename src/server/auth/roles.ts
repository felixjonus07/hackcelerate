/** Role groupings and the home route for each role. Client-safe (no server imports). */
import type { Role } from "../db/schema/enums";

export const STAFF_ROLES: Role[] = [
  "faculty_mentor",
  "class_advisor",
  "hod",
  "dean",
  "placement_officer",
  "ecell_coordinator",
  "sports_officer",
  "registrar",
  "auditor",
  "alumni_mentor",
];

export const APPROVER_ROLES: Role[] = ["faculty_mentor", "class_advisor", "placement_officer"];
export const COMMAND_CENTER_ROLES: Role[] = ["dean", "hod", "faculty_mentor"];

export const ROLE_LABELS: Record<Role, string> = {
  student: "Student",
  faculty_mentor: "Faculty mentor",
  class_advisor: "Class advisor",
  hod: "Head of department",
  dean: "Dean",
  placement_officer: "Placement officer",
  ecell_coordinator: "E-Cell coordinator",
  sports_officer: "Sports and NCC officer",
  registrar: "Registrar",
  auditor: "Auditor",
  alumni_mentor: "Alumni mentor",
};

export function homeFor(role: Role): string {
  if (role === "student") return "/student/passport";
  if (APPROVER_ROLES.includes(role)) return "/admin/approvals";
  if (role === "auditor") return "/admin/audit-report";
  if (role === "registrar") return "/admin/policy";
  if (role === "ecell_coordinator") return "/admin/traction";
  if (role === "sports_officer" || role === "alumni_mentor") return "/leaderboards";
  return "/admin/dashboard";
}
