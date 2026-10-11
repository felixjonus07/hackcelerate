import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Demo credentials (DEMO_PASSWORD) come from the local .env, never from source.
if (existsSync(".env")) process.loadEnvFile(".env");

/** End-to-end journeys (§15.1). Requires a seeded database: npm run db:seed. */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  // The dev server compiles a route on its first visit, so the first render of a page can take a few seconds.
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // The authorization matrix does not depend on the viewport, and the @stateful journeys use up seeded data
    // (onboarding, a quest, a proposal), so both run once, on the desktop project.
    { name: "mobile", use: { ...devices["Pixel 7"] }, testIgnore: /authorization\.spec/, grepInvert: /@stateful/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run dev", url: "http://localhost:3100/sign-in", reuseExistingServer: true, timeout: 120_000 },
});
