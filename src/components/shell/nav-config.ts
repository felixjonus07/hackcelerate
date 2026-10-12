import type { Role } from "@/server/db/schema/enums";

export interface NavItem {
  href: string;
  label: string;
  /** Shorter label for the phone bottom bar. */
  short?: string;
  icon:
    | "passport"
    | "quests"
    | "whatif"
    | "sharing"
    | "approvals"
    | "dashboard"
    | "board"
    | "audit"
    | "students"
    | "leaderboard"
    | "evidence"
    | "attendance"
    | "placement"
    | "traction"
    | "policy"
    | "ingestion"
    | "requests"
    | "users"
    | "notices";
}

export const STUDENT_NAV: NavItem[] = [
  { href: "/student/passport", label: "My passport", icon: "passport" },
  { href: "/student/quests", label: "Quests", icon: "quests" },
  { href: "/student/what-if", label: "What-if", icon: "whatif" },
  { href: "/student/consent", label: "Sharing", icon: "sharing" },
  { href: "/leaderboards", label: "Leaderboards", icon: "leaderboard" },
];

export function staffNav(role: Role): NavItem[] {
  const items: NavItem[] = [];
  const add = (href: string, label: string, icon: NavItem["icon"], short?: string) =>
    items.push({ href, label, icon, short });
  if (["faculty_mentor", "class_advisor", "placement_officer"].includes(role)) {
    add("/admin/approvals", "Approvals", "approvals");
    add("/admin/evidence", "Evidence review", "evidence", "Evidence");
  }
  if (["faculty_mentor", "dean", "hod"].includes(role))
    add("/admin/dashboard", "Command Center", "dashboard", "Command");
  if (role === "faculty_mentor") add("/admin/counseling-kanban", "Counseling board", "board", "Board");
  if (role === "class_advisor") add("/admin/attendance", "Attendance", "attendance");
  if (role === "placement_officer") add("/admin/placement", "Placement readiness", "placement", "Placement");
  if (role === "ecell_coordinator") add("/admin/traction", "Venture traction", "traction", "Traction");
  if (["dean", "auditor", "hod"].includes(role)) add("/admin/audit-report", "Audit report", "audit", "Audit");
  if (["registrar", "dean", "hod", "auditor"].includes(role)) add("/admin/policy", "Policy", "policy");
  if (role === "registrar") {
    add("/admin/ingestion", "Data imports", "ingestion", "Imports");
    add("/admin/requests", "Data requests", "requests", "Requests");
    add("/admin/users", "Users", "users");
  }
  if (role === "faculty_mentor") add("/admin/requests", "Data requests", "requests", "Requests");
  add("/leaderboards", "Leaderboards", "leaderboard");
  add("/notices", "Notices", "notices");
  return items;
}
