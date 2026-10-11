import type { Page } from "@playwright/test";

export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "";

let ipCounter = 0;
/** Give each test its own client IP so the per-IP sign-in rate limit doesn't couple tests. */
export async function freshClientIp(page: Page) {
  ipCounter += 1;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.77.${process.pid % 250}.${ipCounter % 250}` });
}

export async function signIn(page: Page, email: string, opts: { remember?: boolean } = {}) {
  if (!DEMO_PASSWORD) throw new Error("Set DEMO_PASSWORD in .env to run e2e tests");
  await freshClientIp(page);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  if (opts.remember) await page.getByLabel(/Keep me signed in/).check();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
}

export const STUDENT = "student@aspiredge.example";
export const MENTOR = "mentor@aspiredge.example";
