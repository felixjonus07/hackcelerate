/**
 * Re-evaluation after a policy change (§3.3: "affected students are flagged for
 * re-evaluation"). A student is affected when their latest evaluation was made
 * under a different policy version. Existing evaluations are never rewritten:
 * each job writes a new one under the new version.
 */
import { sql } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import { logger } from "../logger";
import { enqueue } from "../queue";

/** Ids of students whose latest evaluation did not use `policyVersion` (or who have none). */
export async function studentsNeedingReevaluation(policyVersion: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    select s.id
    from students s
    left join lateral (
      select e.policy_version from evaluations e where e.student_id = s.id order by e.created_at desc limit 1
    ) latest on true
    where latest.policy_version is distinct from ${policyVersion}
  `);
  return rows.map((r) => r.id);
}

/** Queue one evaluation job per affected student. Job ids make a repeat call a no-op. */
export async function enqueueReevaluation(policyVersion: string, requestedBy: string) {
  const ids = await studentsNeedingReevaluation(policyVersion);
  let queued = 0;
  try {
    for (const studentId of ids) {
      await enqueue(
        "evaluation",
        { studentId, requestedBy, reason: "policy_change" },
        `reeval-${policyVersion}-${studentId}`,
      );
      queued++;
    }
  } catch (err) {
    // Redis down: the nightly refresh re-evaluates everyone, so nothing is lost, only delayed.
    logger.error({ err: String(err), policyVersion }, "could not queue re-evaluation jobs");
  }
  await audit({
    actorUserId: requestedBy,
    actorRole: "system",
    action: "policy.reevaluation_flagged",
    entityType: "policy",
    entityId: policyVersion,
    purpose: "policy_change",
    fieldsAccessed: [`students:${ids.length}`, `queued:${queued}`],
    result: queued === ids.length ? "allowed" : "error",
  });
  return { affected: ids.length, queued };
}
