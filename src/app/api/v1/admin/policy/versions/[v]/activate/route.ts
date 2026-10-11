import { eq } from "drizzle-orm";
import { apiError, handle, json } from "@/server/api/handler";
import { audit } from "@/server/audit/log";
import { requireApiUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { policyVersions } from "@/server/db/schema";

/**
 * POST /api/v1/admin/policy/versions/{v}/activate — records an approval; the
 * version activates on the second distinct approver (§3.3 two-person rule).
 */
export const POST = handle(async (_req: Request, ctx: { params: Promise<{ v: string }> }) => {
  const user = await requireApiUser(["registrar", "dean"]);
  const { v } = await ctx.params;
  const [row] = await db.select().from(policyVersions).where(eq(policyVersions.version, v)).limit(1);
  if (!row) return apiError(404, "not_found", "Policy version not found");
  if (row.status !== "DRAFT") return apiError(409, "not_draft", `Version is ${row.status}`);
  if (row.approvals.some((a) => a.userId === user.id))
    return apiError(409, "already_approved", "A second, different approver is required");
  const approvals = [...row.approvals, { userId: user.id, role: user.role, at: new Date().toISOString() }];
  const activate = approvals.length >= 2;
  await db.transaction(async (tx) => {
    if (activate) await tx.update(policyVersions).set({ status: "RETIRED" }).where(eq(policyVersions.status, "ACTIVE"));
    await tx
      .update(policyVersions)
      .set({
        approvals,
        ...(activate ? { status: "ACTIVE" as const, activatedAt: new Date() } : {}),
      })
      .where(eq(policyVersions.version, v));
  });
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: activate ? "policy.activate" : "policy.approve",
    entityType: "policy",
    entityId: v,
    purpose: "policy_change",
    result: "allowed",
  });
  return json({
    ok: true,
    version: v,
    approvals: approvals.length,
    status: activate ? "ACTIVE" : "DRAFT",
  });
});
