import { handle, json } from "@/server/api/handler";
import { requireApiUser } from "@/server/auth/session";

/** GET /api/v1/leaderboards?track= — opted-in students only. Phase 7 fills the boards. */
export const GET = handle(async () => {
  await requireApiUser();
  return json({ boards: [], note: "No opt-ins yet" });
});
