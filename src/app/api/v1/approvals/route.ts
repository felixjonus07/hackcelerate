import { handle, json } from "@/server/api/handler";
import { APPROVER_ROLES } from "@/server/auth/roles";
import { requireApiUser } from "@/server/auth/session";
import { pendingApprovals } from "@/server/services/approvals";

/** GET /api/v1/approvals?status=PENDING — filtered by the caller's approver role. */
export const GET = handle(async () => {
  const user = await requireApiUser(APPROVER_ROLES);
  return json({ approvals: await pendingApprovals(user) });
});
