import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Demo credentials (DEMO_PASSWORD) come from the local .env, never from source.
if (existsSync(".env")) process.loadEnvFile(".env");

/** End-to-end journeys (§15.1). Requires a seeded database: npm run db:seed. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run dev", url: "http://localhost:3100/sign-in", reuseExistingServer: true, timeout: 120_000 },
});
