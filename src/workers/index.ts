/**
 * BullMQ worker process. Run alongside the Next.js server:
 *   npm run worker
 * Consumers for every queue in src/server/queue, plus the nightly refresh.
 */
import { existsSync, readFileSync } from "node:fs";
import { type Job, Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { createRedis } from "../server/cache/redis";
import { db } from "../server/db";
import { students } from "../server/db/schema";
import { embedRemediationRow } from "../server/embeddings";
import { ingestErpCsv } from "../server/ingestion/erp";
import { logger } from "../server/logger";
import { enqueue, getQueue, type JobPayloads, QUEUES } from "../server/queue";
import { runSlaEscalation } from "../server/services/approvals";
import { runEvaluation } from "../server/services/evaluations";
import { completeQuestOnVerification, runQuestExpiry } from "../server/services/quests";
import { verifyArtifact } from "../server/verification";
import { runRecheckScheduler } from "../server/verification/recheck";

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
    async (job: Job) => {
      const result = await verifyArtifact(job.data.artifactId, job.data.kind, job.data.attempt);
      // When verification succeeds, complete any linked quest (§8.3).
      await completeQuestOnVerification(job.data.artifactId).catch((err) =>
        logger.warn({ err: String(err), artifactId: job.data.artifactId }, "quest completion check failed"),
      );
      return result;
    },
    { connection, concurrency: 4 },
  ),

  new Worker<JobPayloads["ingestion"]>(
    QUEUES.ingestion,
    async (job: Job) => {
      let content = job.data.csvContent;
      if (!content && job.data.filePath && existsSync(job.data.filePath)) {
        content = readFileSync(job.data.filePath, "utf8");
      }
      if (content) {
        await ingestErpCsv(content, { source: job.data.source });
      }
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
      switch (job.data.task) {
        case "sla_escalation": {
          const result = await runSlaEscalation();
          return result;
        }
        case "quest_expiry": {
          const result = await runQuestExpiry();
          return result;
        }
        case "recheck_evidence": {
          const result = await runRecheckScheduler();
          return result;
        }
        default:
          logger.info({ task: job.data.task }, "maintenance task not implemented yet (PLAN.md Phase 9)");
      }
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

async function start() {
  // Nightly cohort refresh at 02:00 IST (§10.2).
  await getQueue("ingestion").upsertJobScheduler(
    "nightly-refresh",
    { pattern: "0 2 * * *", tz: "Asia/Kolkata" },
    { name: "ingestion", data: { source: "erp_nightly" } },
  );

  // Evidence recheck every day at 03:00 IST (§6.2, §15).
  await getQueue("maintenance").upsertJobScheduler(
    "evidence-recheck",
    { pattern: "0 3 * * *", tz: "Asia/Kolkata" },
    { name: "maintenance", data: { task: "recheck_evidence" } },
  );

  // SLA escalation every weekday at 08:00 IST (§8.1).
  await getQueue("maintenance").upsertJobScheduler(
    "sla-escalation",
    { pattern: "0 8 * * 1-5", tz: "Asia/Kolkata" },
    { name: "maintenance", data: { task: "sla_escalation" } },
  );

  // Quest expiry every day at 06:00 IST (§8.3).
  await getQueue("maintenance").upsertJobScheduler(
    "quest-expiry",
    { pattern: "0 6 * * *", tz: "Asia/Kolkata" },
    { name: "maintenance", data: { task: "quest_expiry" } },
  );

  logger.info({ queues: Object.values(QUEUES) }, "workers started");
}

start().catch((err) => {
  logger.error({ err }, "failed to start workers");
  process.exit(1);
});

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
