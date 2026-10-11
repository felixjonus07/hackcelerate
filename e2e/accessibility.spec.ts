import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { MENTOR, STUDENT, signIn } from "./helpers";

/**
 * axe-core on every screen (WCAG 2.1 A/AA). The manual screen-reader pass on the core journeys is a
 * human task and is tracked separately in PLAN.md.
 */
const REGISTRAR = "registrar@aspiredge.example";
const ADVISOR = "advisor@aspiredge.example";
const AUDITOR = "auditor@aspiredge.example";
const PLACEMENT = "placement@aspiredge.example";
const ECELL = "ecell@aspiredge.example";

const SCREENS: { as: string | null; path: string }[] = [
  { as: null, path: "/sign-in" },
  { as: STUDENT, path: "/student/passport" },
  { as: STUDENT, path: "/student/what-if" },
  { as: STUDENT, path: "/student/quests" },
  { as: STUDENT, path: "/student/consent" },
  { as: STUDENT, path: "/leaderboards" },
  { as: STUDENT, path: "/notices" },
  { as: STUDENT, path: "/account/security" },
  { as: MENTOR, path: "/admin/approvals" },
  { as: MENTOR, path: "/admin/evidence" },
  { as: MENTOR, path: "/admin/dashboard" },
  { as: MENTOR, path: "/admin/counseling-kanban" },
  { as: MENTOR, path: "/admin/requests" },
  { as: ADVISOR, path: "/admin/attendance" },
  { as: PLACEMENT, path: "/admin/placement" },
  { as: ECELL, path: "/admin/traction" },
  { as: REGISTRAR, path: "/admin/policy" },
  { as: REGISTRAR, path: "/admin/ingestion" },
  { as: AUDITOR, path: "/admin/audit-report" },
];

for (const screen of SCREENS) {
  test(`axe: ${screen.path}${screen.as ? ` as ${screen.as.split("@")[0]}` : ""}`, async ({ page }) => {
    if (screen.as) await signIn(page, screen.as);
    await page.goto(screen.path);
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target).join(" | ")}`);
    expect(summary, `axe violations on ${screen.path}`).toEqual([]);
  });
}
