import type { Role } from "@/server/db/schema/enums";

export interface NavItem {
  href: string;
  label: string;
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
    | "leaderboard";
}

export const STUDENT_NAV: NavItem[] = [
  { href: "/student/passport", label: "My passport", icon: "passport" },
  { href: "/student/quests", label: "Quests", icon: "quests" },
  { href: "/student/what-if", label: "What-if", icon: "whatif" },
  { href: "/student/consent", label: "Sharing", icon: "sharing" },
];

export function staffNav(role: Role): NavItem[] {
  const items: NavItem[] = [];
  if (["faculty_mentor", "class_advisor", "placement_officer"].includes(role))
    items.push({
      href: "/admin/approvals",
      label: "Approvals",
      icon: "approvals",
    });
  if (["faculty_mentor", "dean", "hod"].includes(role))
    items.push({
      href: "/admin/dashboard",
      label: "Command Center",
      icon: "dashboard",
    });
  if (role === "faculty_mentor")
    items.push({
      href: "/admin/counseling-kanban",
      label: "Counseling board",
      icon: "board",
    });
  if (["dean", "auditor", "hod"].includes(role))
    items.push({
      href: "/admin/audit-report",
      label: "Audit report",
      icon: "audit",
    });
  return items;
}
