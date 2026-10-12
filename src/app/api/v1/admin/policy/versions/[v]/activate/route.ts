import { rolesOf } from "@/server/api/access";
import { apiError, handle, json } from "@/server/api/handler";
import { requireApiUser } from "@/server/auth/session";
import { approveVersion, PolicyError } from "@/server/services/policy-admin";

/**
 * POST /api/v1/admin/policy/versions/{v}/activate — records the caller's approval; the version
 * activates once it has the approvals its change needs: two for persona changes (§3.3), else one.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ v: string }> }) => {
  const user = await requireApiUser(rolesOf("policy-activate"));
  const { v } = await ctx.params;
  try {
    const r = await approveVersion(user, v, req.headers.get("x-forwarded-for"));
    return json({ ok: true, version: v, ...r });
  } catch (e) {
    if (e instanceof PolicyError) return apiError(e.code === "not_found" ? 404 : 409, e.code, e.message);
    throw e;
  }
});
