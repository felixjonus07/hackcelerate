import { rolesOf } from "@/server/api/access";
import { handle, json } from "@/server/api/handler";
import { requireApiUser } from "@/server/auth/session";
import { cohortSummary } from "@/server/services/cohort";

/** GET /api/v1/cohorts?dept= — aggregates only (dean, HOD, mentor scoped). */
export const GET = handle(async (req: Request) => {
  const user = await requireApiUser(rolesOf("cohorts"));
  const dept = new URL(req.url).searchParams.get("dept") ?? undefined;
  return json(await cohortSummary(user, dept));
});
