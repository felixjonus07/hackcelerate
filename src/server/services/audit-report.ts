/** Aggregated audit report (§12.3 /admin/audit-report). Aggregates only. */
import { desc, sql } from "drizzle-orm";
import { db } from "../db";
import { auditEvents, evaluations, interventions } from "../db/schema";
import { getActivePolicy } from "../policy/load";

export async function auditReport() {
  const policy = getActivePolicy();
  const [evalStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      fallback: sql<number>`count(*) filter (where fallback)::int`,
      students: sql<number>`count(distinct student_id)::int`,
    })
    .from(evaluations);
  const byIndex = await db
    .select({ level: evaluations.aegIndex, n: sql<number>`count(*)::int` })
    .from(evaluations)
    .groupBy(evaluations.aegIndex);
  const byStatus = await db
    .select({ status: interventions.status, n: sql<number>`count(*)::int` })
    .from(interventions)
    .groupBy(interventions.status);
  const recent = await db
    .select({
      action: auditEvents.action,
      n: sql<number>`count(*)::int`,
      last: sql<Date>`max(${auditEvents.at})`,
    })
    .from(auditEvents)
    .groupBy(auditEvents.action)
    .orderBy(desc(sql`count(*)`))
    .limit(10);
  return {
    policy: {
      version: policy.policy_version,
      status: policy.status,
      note: policy.status_note,
    },
    evalStats,
    byIndex,
    byStatus,
    recent,
    generatedAt: new Date(),
  };
}
