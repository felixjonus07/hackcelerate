import { rolesOf } from "@/server/api/access";
import { handle, json } from "@/server/api/handler";
import { audit } from "@/server/audit/log";
import { requireApiUser } from "@/server/auth/session";
import { auditReport } from "@/server/services/audit-report";

/** GET /api/v1/audit-report — aggregates (JSON). PDF export: print the /admin/audit-report page (Phase 8 adds server PDF). */
export const GET = handle(async () => {
  const user = await requireApiUser(rolesOf("audit-report"));
  const r = await auditReport();
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "audit_report.export",
    entityType: "report",
    entityId: r.policy.version,
    purpose: "audit_request",
    result: "allowed",
  });
  return json(r);
});
