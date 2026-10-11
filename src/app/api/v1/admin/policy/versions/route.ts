import { desc } from "drizzle-orm";
import { handle, json } from "@/server/api/handler";
import { audit } from "@/server/audit/log";
import { requireApiUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { policyVersions } from "@/server/db/schema";
import { policySchema } from "@/server/policy/schema";

/** GET /api/v1/admin/policy/versions — list all policy versions (registrar, dean, hod, auditor). */
export const GET = handle(async () => {
  await requireApiUser(["registrar", "dean", "hod", "auditor"]);
  const rows = await db
    .select({
      version: policyVersions.version,
      status: policyVersions.status,
      effectiveFrom: policyVersions.effectiveFrom,
      createdBy: policyVersions.createdBy,
      approvals: policyVersions.approvals,
      activatedAt: policyVersions.activatedAt,
      createdAt: policyVersions.createdAt,
    })
    .from(policyVersions)
    .orderBy(desc(policyVersions.createdAt));

  return json({ ok: true, versions: rows });
});

/** POST /api/v1/admin/policy/versions — create a DRAFT policy version (registrar). */
export const POST = handle(async (req: Request) => {
  const user = await requireApiUser(["registrar"]);
  const doc = policySchema.parse(await req.json());
  await db.insert(policyVersions).values({
    version: doc.policy_version,
    status: "DRAFT",
    effectiveFrom: new Date(doc.effective_from),
    document: { ...doc, status: "DRAFT" },
    createdBy: user.id,
  });
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "policy.create",
    entityType: "policy",
    entityId: doc.policy_version,
    purpose: "policy_change",
    result: "allowed",
  });
  return json({ ok: true, version: doc.policy_version, status: "DRAFT" }, { status: 201 });
});
