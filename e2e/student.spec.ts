/**
 * Student Experience End-to-End Journeys (PLAN.md Phase 7 exit gate).
 * Tests "onboarding", "passport and quest", and "consent change".
 */
import { expect, test } from "@playwright/test";
import { STUDENT, signIn } from "./helpers";

test("journey: onboarding end-to-end wizard", async ({ page }) => {
  await signIn(page, STUDENT);
  await page.goto("/student/onboarding");

  // Step 0: Notice card
  await expect(page.getByRole("heading", { name: "What we collect" })).toBeVisible();
  await expect(page.getByText("Your CGPA and attendance from the university records")).toBeVisible();
  await page.getByRole("button", { name: "I understand" }).click();

  // Step 1: Consent choices
  await expect(page.getByRole("heading", { name: "Who sees it" })).toBeVisible();
  await expect(page.getByText("Placement cell")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2: Baseline records
  await expect(page.getByRole("heading", { name: "Your records" })).toBeVisible();
  await expect(page.getByText("Department")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3: Ambition
  await expect(page.getByRole("heading", { name: "Your ambition" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save ambition" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 4: Evidence
  await expect(page.getByRole("heading", { name: "Your evidence" })).toBeVisible();
  await expect(page.getByText("Add initial evidence")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 5: Passport
  await expect(page.getByRole("heading", { name: "Your passport" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open my passport" })).toBeVisible();
});

test("journey: passport and quest", async ({ page }) => {
  await signIn(page, STUDENT);
  await page.goto("/student/passport");

  // Passport score and target readiness
  await expect(page.getByText("track score")).toBeVisible();
  await expect(page.getByRole("heading", { name: /How your score is built/i })).toBeVisible();

  // Campus counseling & emergency contacts in footer (§14.2)
  await expect(page.getByText("Campus counseling centre")).toBeVisible();
  await expect(page.getByText("Emergency: 112")).toBeVisible();

  // Quests navigation
  await page.goto("/student/quests");
  await expect(page.getByRole("heading", { name: "Quests" })).toBeVisible();
  await expect(page.getByText("Your evidence")).toBeVisible();
});

test("journey: consent change and data rights", async ({ page }) => {
  await signIn(page, STUDENT);
  await page.goto("/student/consent");

  // Sharing toggles
  await expect(page.getByRole("heading", { name: "Sharing with offices" })).toBeVisible();
  await expect(page.getByText("Mentor")).toBeVisible();

  // Leaderboard opt-in toggle
  await expect(page.getByText("Show me on my track's leaderboard")).toBeVisible();

  // Rights requests
  await expect(page.getByRole("heading", { name: "Your data rights" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download my data" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request a correction" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request erasure" })).toBeVisible();

  // Leaderboards tabbed page
  await page.goto("/leaderboards");
  await expect(page.getByRole("heading", { name: "Leaderboards" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Corporate Placement" })).toBeVisible();
});
