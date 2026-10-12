/**
 * Scheduled maintenance tasks, run by the maintenance worker and callable from tests. Each task is
 * idempotent: running it twice in a day does the work once.
 */
import { db } from "../db";
import { students } from "../db/schema";
import { logger } from "../logger";
import { buildWeeklyDigests, deliverPending } from "../notifications/digest";
import { getActivePolicy } from "../policy/load";
import { flagImplausibleSpeed } from "../verification/flags";
import { expireAttestations, queueDueRechecks, sampleExternalMocks } from "../verification/recheck";
import { runSlaEscalation } from "./escalation";
import { rolloverPolicies } from "./policy-admin";
import { expireDueQuests } from "./quests";
import { runRetention } from "./retention";
import { refreshCohortSignals } from "./signals";
import { scanAllWellbeing } from "./wellbeing";

export type MaintenanceTask =
  | "recheck_evidence"
  | "sample_external_mocks"
  | "policy_rollover"
  | "sla_escalation"
  | "quest_expiry"
  | "retention"
  | "wellbeing_scan"
  | "weekly_digest"
  | "refresh_signals";

type TaskFn = (now: Date) => Promise<Record<string, unknown>>;

export const TASKS: Record<MaintenanceTask, TaskFn> = {
  recheck_evidence: async (now) => ({
    queued: await queueDueRechecks(now),
    expiredAttestations: await expireAttestations(now),
  }),
  sample_external_mocks: async (now) => {
    const policy = await getActivePolicy();
    return { sampled: await sampleExternalMocks(policy.calendar.term.start, now) };
  },
  policy_rollover: async (now) => ({ retired: await rolloverPolicies(now) }),
  // Registered by their own modules as they are built; see `registerTask` below.
  sla_escalation: async (now) => ({ ...(await runSlaEscalation(now)) }),
  quest_expiry: async (now) => ({ expired: await expireDueQuests(now) }),
  retention: async (now) => ({ ...(await runRetention(now)) }),
  wellbeing_scan: async (now) => ({ nudges: await scanAllWellbeing(now) }),
  weekly_digest: async (now) => ({ digests: await buildWeeklyDigests(now), ...(await deliverPending(undefined, now)) }),
  // Cohort statistics for the Detention Threat Builder (§7.3), and the nightly integrity scan (§6.3).
  refresh_signals: async () => {
    const signals = await refreshCohortSignals();
    const ids = await db.select({ id: students.id }).from(students);
    let speedFlags = 0;
    for (const s of ids) speedFlags += await flagImplausibleSpeed(s.id);
    return { ...signals, speedFlags };
  },
};

export function registerTask(name: MaintenanceTask, fn: TaskFn) {
  TASKS[name] = fn;
}

export async function runMaintenance(task: MaintenanceTask, now = new Date()) {
  const result = await TASKS[task](now);
  logger.info({ task, ...result }, "maintenance task finished");
  return result;
}
