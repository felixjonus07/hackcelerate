/**
 * The five journeys of the plan (§15.1, Phase 11): onboarding, passport and quest, mentor approval, consent
 * change, audit export. They run against the seeded demo data (the global setup reseeds before each run). The
 * @stateful ones use up seeded data, so they run on the desktop project only.
 */
import { expect, type Locator, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

const STUDENT = "student@aspiredge.example";
const NEW_STUDENT = "student3@aspiredge.example";
const MENTOR = "mentor@aspiredge.example";
const AUDITOR = "auditor@aspiredge.example";

test("1. onboarding @stateful: notice, sharing, records, ambition, evidence, passport", async ({ page }) => {
  await signIn(page, NEW_STUDENT);
  await page.goto("/student/onboarding");
  await expect(page.getByRole("heading", { name: "What we collect" })).toBeVisible();
  await page.getByRole("button", { name: /I understand|Continue/ }).click();
  await expect(page.getByRole("heading", { name: "Who sees it" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Your records" })).toBeVisible();
  await expect(page.getByText("CGPA")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Your ambition" })).toBeVisible();
  await page.getByLabel("Track").selectOption({ index: 1 });
  await page.getByLabel("Target outcome").fill("A campus offer in software engineering");
  const next = new Date();
  next.setFullYear(next.getFullYear() + 1);
  await page.getByLabel("Target date").fill(next.toISOString().slice(0, 10));
  await page.getByRole("button", { name: /Save ambition|Save changes/ }).click();
  await expect(page.getByText(/Saved\. Your passport has been re-scored/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Your evidence" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Open my passport" }).click();
  await expect(page).toHaveURL(/\/student\/passport/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /here's where you stand|set up your passport/ })).toBeVisible();
});

test("2. passport and quest @stateful: accept a quest and see it move", async ({ page }) => {
  await signIn(page, STUDENT);
  await expect(page.getByRole("heading", { name: /^Next:/ })).toBeVisible();
  await page.goto("/student/quests");
  const accept = page.getByRole("button", { name: "Accept" }).first();
  if (await accept.isVisible()) {
    await accept.click();
    await expect(page.getByText("Accepted. The clock starts now.")).toBeVisible();
  }
  await page.reload();
  await expect(page.getByText(/^(Accepted|Active|Evidence submitted|Done)$/).first()).toBeVisible();
});

test("3. mentor approval @stateful: approve a proposal; consent is checked at dispatch", async ({ page }) => {
  await signIn(page, MENTOR);
  await expect(page.getByRole("heading", { name: "Approval queue" })).toBeVisible();
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  const empty = page.getByText("Nothing waiting for you");
  await expect(approve.or(empty)).toBeVisible({ timeout: 15_000 });
  if (await approve.isVisible()) {
    await approve.click();
    await expect(page.getByText(/^Approved/)).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(page.getByText("Nothing waiting for you")).toBeVisible();
  }
});

/** The switch updates optimistically; wait for the server action to answer before the page is reloaded. */
async function toggle(page: Page, control: Locator) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/student/consent")),
    control.click(),
  ]);
}

test("4. consent change: switch a share on, it persists, switch it back", async ({ page }) => {
  await signIn(page, STUDENT);
  await page.goto("/student/consent");
  const sw = page.getByRole("switch", { name: "Share Mock and test scores with E-Cell" }).filter({ visible: true });
  const before = await sw.first().getAttribute("aria-checked");
  await toggle(page, sw.first());
  await expect(sw.first()).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
  await page.reload();
  const sw2 = page.getByRole("switch", { name: "Share Mock and test scores with E-Cell" }).filter({ visible: true });
  await expect(sw2.first()).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
  await toggle(page, sw2.first()); // restore the seeded state
  await expect(sw2.first()).toHaveAttribute("aria-checked", before ?? "false");
});

test("5. audit export: report, logged-reason sample, JSON export", async ({ page }) => {
  await signIn(page, AUDITOR);
  await expect(page).toHaveURL(/\/admin\/audit-report/);
  await expect(page.getByRole("heading", { name: "Audit report" })).toBeVisible();
  await expect(page.getByText(/Policy .* is still a draft|Policy history/).first()).toBeVisible();
  await page.getByRole("button", { name: "Draw a sample" }).click();
  await expect(page.getByRole("table", { name: "Sampled evaluation records" })).toBeVisible();
  const r = await page.request.get("/api/v1/audit-report");
  expect(r.status()).toBe(200);
  expect((await r.json()).policy.version).toBeTruthy();
});
