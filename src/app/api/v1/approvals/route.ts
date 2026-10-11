import { rolesOf } from "@/server/api/access";
import { handle, json } from "@/server/api/handler";
import { requireApiUser } from "@/server/auth/session";
import { pendingApprovals } from "@/server/services/approvals";

/** GET /api/v1/approvals?status=PENDING — filtered by the caller's approver role. */
export const GET = handle(async () => {
  const user = await requireApiUser(rolesOf("approvals"));
  return json({ approvals: await pendingApprovals(user) });
});
