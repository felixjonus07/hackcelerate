/**
 * BullMQ queue registry. Producers live in Next.js route handlers and server
 * actions; consumers live in `src/workers` (run with `npm run worker`).
 */
import { Queue } from "bullmq";
import { createRedis } from "../cache/redis";

export const QUEUES = {
  /** Re-run the rules engine + narrative for one student (§10.2 "Run Eval"). */
  evaluation: "evaluation",
  /** GitHub / Crossref / link / certificate checks (§6.2). */
  verification: "verification",
  /** Nightly cohort refresh and ERP ingestion (§10.2). */
  ingestion: "ingestion",
  /** SLA escalation, quest expiry, retention jobs (§8, §13.5). */
  maintenance: "maintenance",
  /** Embeddings for pgvector catalog matching. */
  embeddings: "embeddings",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobPayloads {
  evaluation: {
    studentId: string;
    requestedBy: string;
    reason: "run_eval" | "nightly" | "policy_change" | "evidence_added" | "erp_import";
  };
  verification: {
    artifactId: string;
    kind: "github" | "crossref" | "link" | "certificate";
    attempt?: number;
  };
  ingestion: {
    source: "erp_nightly" | "manual";
    filePath?: string;
    csvContent?: string;
  };
  maintenance: {
    task: import("../services/maintenance").MaintenanceTask;
  };
  embeddings: { table: "opportunities" | "remediation_library"; id: string };
}

const globalForQueues = globalThis as unknown as {
  queues?: Map<string, Queue>;
};
const queues = globalForQueues.queues ?? new Map<string, Queue>();
globalForQueues.queues = queues;

export function getQueue<N extends QueueName>(name: N): Queue<JobPayloads[N]> {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: createRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    });
    queues.set(name, q);
  }
  return q as Queue<JobPayloads[N]>;
}

export async function enqueue<N extends QueueName>(name: N, data: JobPayloads[N], jobId?: string) {
  // BullMQ's generic name typing is stricter than our payload map needs.
  return (getQueue(name) as Queue).add(name, data, jobId ? { jobId } : undefined);
}
