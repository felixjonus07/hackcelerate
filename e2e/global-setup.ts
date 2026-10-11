import { execFileSync } from "node:child_process";

/**
 * The journeys change data (a student finishes onboarding, a mentor approves a proposal, a quest is accepted),
 * so each run starts from the seeded demo data. Set E2E_NO_RESEED=1 to skip, e.g. when iterating on one test.
 * Never reseeds a database that is not on this machine, and never when pointed at a remote app.
 */
export default function globalSetup() {
  if (process.env.E2E_NO_RESEED === "1" || process.env.E2E_BASE_URL) return;
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    throw new Error("e2e reseeds the demo data and only does so on a local database. Set E2E_NO_RESEED=1 to skip.");
  }
  execFileSync("npm", ["run", "db:seed"], { stdio: "ignore" });
}
