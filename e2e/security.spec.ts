/** Sign-in and session security journeys (§13.2, PLAN.md Phase 9). */
import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, freshClientIp, MENTOR, STUDENT, signIn } from "./helpers";

test("no demo credentials are shipped to the browser", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (r) => {
    if (/\.(js|html)$|\/sign-in/.test(r.url())) bodies.push(await r.text().catch(() => ""));
  });
  await page.goto("/sign-in");
  await page.waitForLoadState("networkidle");
  expect(bodies.join("\n")).not.toContain(DEMO_PASSWORD);
});

test("wrong passwords lock the account after five attempts, even for unknown emails", async ({ page }) => {
  const email = `nobody-${Date.now()}@aspiredge.example`;
  for (let i = 1; i <= 6; i++) {
    await freshClientIp(page); // isolate from the per-IP limit: this tests the per-account lock
    const res = await page.request.post("/api/auth/sign-in/email", {
      data: { email, password: "definitely-wrong-123" },
      headers: { Origin: "http://localhost:3100", "x-forwarded-for": `10.88.0.${i}` },
    });
    expect(res.status()).toBe(i <= 5 ? 401 : 429);
  }
});

test("sign-in errors never reveal whether an account exists", async ({ page }) => {
  await freshClientIp(page);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(MENTOR);
  await page.getByLabel("Password").fill("wrong-password-xyz");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(/email and password don't match/)).toBeVisible();
});

test("cross-origin sign-in attempts are rejected", async ({ page }) => {
  const res = await page.request.post("/api/auth/sign-in/email", {
    data: { email: STUDENT, password: DEMO_PASSWORD },
    headers: { Origin: "https://evil.example", "x-forwarded-for": "10.89.0.1" },
  });
  expect(res.status()).toBe(403);
});

test("signed-in users see their session and a timeout policy on Account security", async ({ page }) => {
  await signIn(page, STUDENT, { remember: true });
  await page.goto("/account/security");
  await expect(page.getByRole("heading", { name: "Account security" })).toBeVisible();
  await expect(page.getByText("Trusted")).toBeVisible();
  await expect(page.getByText("30 days").first()).toBeVisible();
});

test("signing out ends the session server-side", async ({ page }) => {
  await signIn(page, MENTOR);
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL(/\/sign-in\?reason=signed_out/);
  const res = await page.request.post("/api/session/heartbeat");
  expect(res.status()).toBe(401);
  await page.goto("/admin/approvals");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("staff can't be remembered even if they ask", async ({ page }) => {
  await signIn(page, MENTOR, { remember: true });
  await page.goto("/account/security");
  await expect(page.getByText("Not remembered")).toBeVisible();
});

test("protected pages are never cached by the browser", async ({ page }) => {
  await signIn(page, STUDENT);
  const res = await page.goto("/student/passport");
  expect(res?.headers()["cache-control"]).toContain("no-store");
});
