/**
 * BullMQ worker process. Run alongside the Next.js server:
 *   npm run worker
 * Consumers for every queue in src/server/queue, plus the nightly refresh.
 */
import { type Job, Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { createRedis } from "../server/cache/redis";
import { db } from "../server/db";
import { students } from "../server/db/schema";
import { embedRemediationRow } from "../server/embeddings";
import { logger } from "../server/logger";
import { enqueue, getQueue, type JobPayloads, QUEUES } from "../server/queue";
import { runEvaluation } from "../server/services/evaluations";
import { verifyArtifact } from "../server/verification";

const connection = createRedis();
const concurrency = 8; // §10.3: nightly batch at concurrency 8

const workers = [
  new Worker<JobPayloads["evaluation"]>(
    QUEUES.evaluation,
    async (job: Job) => {
      const ev = await runEvaluation(job.data.studentId, {
        actorUserId: job.data.requestedBy,
      });
      return { evaluationId: ev.id, aegIndex: ev.aegIndex };
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
    async (job: Job) => {
      // Phase 1: ERP CSV import with checksums. For now, the nightly job re-evaluates everyone.
      const rows = await db.select({ id: students.id }).from(students).where(sql`true`);
      for (const r of rows)
        await enqueue("evaluation", {
          studentId: r.id,
          requestedBy: "system",
          reason: "nightly",
        });
      return { queued: rows.length, source: job.data.source };
    },
    { connection },
  ),

  new Worker<JobPayloads["maintenance"]>(
    QUEUES.maintenance,
    async (job: Job) => {
      logger.info({ task: job.data.task }, "maintenance task not implemented yet (PLAN.md Phases 6, 9)");
    },
    { connection },
  ),

  new Worker<JobPayloads["embeddings"]>(
    QUEUES.embeddings,
    async (job: Job) => {
      if (job.data.table === "remediation_library") await embedRemediationRow(job.data.id);
    },
    { connection },
  ),
];

for (const w of workers) {
  w.on("failed", (job, err) => logger.error({ queue: w.name, jobId: job?.id, err: err.message }, "job failed"));
  w.on("completed", (job) => logger.info({ queue: w.name, jobId: job.id }, "job completed"));
}

// Nightly cohort refresh at 02:00 IST (§10.2).
await getQueue("ingestion").upsertJobScheduler(
  "nightly-refresh",
  { pattern: "0 2 * * *", tz: "Asia/Kolkata" },
  { name: "ingestion", data: { source: "erp_nightly" } },
);
logger.info({ queues: Object.values(QUEUES) }, "workers started");

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
