/**
 * BullMQ worker process. Run alongside the Next.js server:
 *   npm run worker
 * Consumers for every queue in src/server/queue, plus the nightly refresh.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { type Job, Worker } from "bullmq";
import { createRedis } from "../server/cache/redis";
import { db } from "../server/db";
import { students } from "../server/db/schema";
import { embedOpportunityRow, embedRemediationRow } from "../server/embeddings";
import { env } from "../server/env";
import { logger } from "../server/logger";
import { enqueue, getQueue, type JobPayloads, QUEUES } from "../server/queue";
import { importErp } from "../server/services/erp-import";
import { runEvaluation } from "../server/services/evaluations";
import { runMaintenance } from "../server/services/maintenance";
import { ParentalConsentRequired } from "../server/services/parental";
import { verifyArtifact } from "../server/verification";

// BullMQ workers keep blocking Redis commands open for several seconds. createRedis() defaults to a 3 s command
// timeout and stops reconnecting after 3 tries: right for web requests, but it makes every blocking call fail here.
const connection = createRedis({
  commandTimeout: undefined,
  retryStrategy: (times) => Math.min(times * 200, 3000),
});
const concurrency = 8; // §10.3: nightly batch at concurrency 8

const workers = [
  new Worker<JobPayloads["evaluation"]>(
    QUEUES.evaluation,
    async (job: Job) => {
      try {
        const ev = await runEvaluation(job.data.studentId, { actorUserId: job.data.requestedBy });
        return { evaluationId: ev.id, aegIndex: ev.aegIndex };
      } catch (e) {
        // A student under 18 without verified parental consent is skipped, not retried (§13.4).
        if (e instanceof ParentalConsentRequired) return { skipped: "awaiting parental consent" };
        throw e;
      }
    },
    { connection, concurrency },
  ),

  new Worker<JobPayloads["verification"]>(
    QUEUES.verification,
    async (job: Job) => verifyArtifact(job.data.artifactId, job.data.kind),
    { connection, concurrency: 4 },
  ),

  new Worker<JobPayloads["ingestion"]>(
    QUEUES.ingestion,
    async (job: Job<JobPayloads["ingestion"]>) => {
      // §10.2: ingestion first (checksum, rejects, stale marking), then the cohort is re-evaluated.
      const file = job.data.filePath ?? env.ERP_EXPORT_FILE;
      let imported: Awaited<ReturnType<typeof importErp>> | null = null;
      if (file) {
        const text = await readFile(file, "utf8").catch((e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") return null;
          throw e;
        });
        imported = await importErp({ fileName: basename(file), text, source: job.data.source });
        logger.info({ status: imported.status, rejected: imported.rowsRejected }, "ERP import finished");
      }
      // Cohort statistics and integrity scan first, so the evaluations below use fresh signals.
      await runMaintenance("refresh_signals");
      // A manual import re-scores only who changed; the nightly run re-scores everyone (narratives are cached).
      const ids =
        job.data.source === "manual" && imported
          ? imported.changedStudentIds
          : (await db.select({ id: students.id }).from(students)).map((r) => r.id);
      for (const id of ids)
        await enqueue("evaluation", {
          studentId: id,
          requestedBy: "system",
          reason: job.data.source === "manual" ? "erp_import" : "nightly",
        });
      return { queued: ids.length, source: job.data.source, import: imported?.status ?? "not configured" };
    },
    { connection },
  ),

  new Worker<JobPayloads["maintenance"]>(
    QUEUES.maintenance,
    async (job: Job<JobPayloads["maintenance"]>) => runMaintenance(job.data.task),
    { connection },
  ),

  new Worker<JobPayloads["embeddings"]>(
    QUEUES.embeddings,
    async (job: Job<JobPayloads["embeddings"]>) => {
      if (job.data.table === "remediation_library") await embedRemediationRow(job.data.id);
      else await embedOpportunityRow(job.data.id);
    },
    { connection },
  ),
];

for (const w of workers) {
  w.on("failed", (job, err) => logger.error({ queue: w.name, jobId: job?.id, err: err.message }, "job failed"));
  w.on("completed", (job) => logger.info({ queue: w.name, jobId: job.id }, "job completed"));
}

// Not top-level await: the package is CommonJS by default, so tsx compiles this file as CJS and rejects it.
async function registerSchedules() {
  // Nightly cohort refresh at 02:00 IST (§10.2).
  await getQueue("ingestion").upsertJobScheduler(
    "nightly-refresh",
    { pattern: "0 2 * * *", tz: "Asia/Kolkata" },
    { name: "ingestion", data: { source: "erp_nightly" } },
  );

  // Scheduled maintenance (Asia/Kolkata): evidence re-checks, policy rollover, external-report sampling.
  for (const [name, pattern, task] of [
    ["recheck-evidence", "0 3 * * *", "recheck_evidence"],
    ["policy-rollover", "5 0 * * *", "policy_rollover"],
    ["sample-external-mocks", "0 4 1 * *", "sample_external_mocks"],
    ["quest-expiry", "30 0 * * *", "quest_expiry"],
    ["wellbeing-scan", "15 3 * * *", "wellbeing_scan"],
    ["weekly-digest", "0 8 * * 1", "weekly_digest"],
    ["retention", "30 2 * * 0", "retention"],
    ["sla-escalation", "0 * * * *", "sla_escalation"],
  ] as const)
    await getQueue("maintenance").upsertJobScheduler(
      name,
      { pattern, tz: "Asia/Kolkata" },
      { name: "maintenance", data: { task } },
    );
  logger.info({ queues: Object.values(QUEUES) }, "workers started");
}

registerSchedules().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "could not register job schedules");
  process.exit(1);
});

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
