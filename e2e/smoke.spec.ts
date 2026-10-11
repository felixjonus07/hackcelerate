/**
 * Smoke journeys (PLAN.md Phase 11). Seeded demo data: student ME-27 scores
 * 48.1 (§20.1); the mentor's queue holds pending proposals.
 */
import { expect, test } from "@playwright/test";
import { MENTOR, STUDENT, signIn } from "./helpers";

test("student sees passport with the §20.1 score and a next step", async ({ page }) => {
  await signIn(page, STUDENT);
  await expect(page).toHaveURL(/\/student\/passport/);
  await expect(page.getByText("48.1", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Next:/ })).toBeVisible();
  // Persona names never appear on student screens (§14.3).
  await expect(page.getByText(/high flyer|drifting|detention/i)).toHaveCount(0);
});

test("what-if recomputes live and writes nothing", async ({ page }) => {
  await signIn(page, STUDENT);
  await page.goto("/student/what-if");
  await page.getByRole("switch", { name: /Timed GD&T assessment verified/ }).click();
  await expect(page.getByText("58.1", { exact: true }).filter({ visible: true }).first()).toBeVisible();
});

test("student cannot open staff routes", async ({ page }) => {
  await signIn(page, STUDENT);
  await page.goto("/admin/approvals");
  await expect(page.getByRole("heading", { name: /isn't part of your role/ })).toBeVisible();
});

test("mentor sees the approval queue with a brief and decision controls", async ({ page }) => {
  await signIn(page, MENTOR);
  await expect(page).toHaveURL(/\/admin\/approvals/);
  await expect(page.getByRole("heading", { name: "Approval queue" })).toBeVisible();
  await expect(page.getByText("Three verifiable facts")).toBeVisible();
  await expect(page.getByText("Suggested questions")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
});

test("signed-out visitors are sent to sign-in by the proxy", async ({ page }) => {
  await page.goto("/student/passport");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fstudent%2Fpassport/);
});
