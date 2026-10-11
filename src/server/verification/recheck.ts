/**
 * Recheck scheduler (§6.2, §15).
 *
 * - Runs as a repeatable BullMQ job via the maintenance queue.
 * - Finds VERIFIED and LIVE_UNVERIFIED artifacts due for a recheck (every 30 days).
 * - Enqueues them for re-verification.
 * - STALE after one failed recheck; UNVERIFIED after two failures (§15).
 *
 * The recheck state machine:
 *   VERIFIED → (fail) → STALE → (fail) → UNVERIFIED
 *   VERIFIED → (fail) → STALE → (pass) → VERIFIED
 */
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { artifacts } from "../db/schema";
import { logger } from "../logger";
import { enqueue } from "../queue";
import { getRealDeps, LifecycleError, transitionArtifact } from "./lifecycle";

/* ────────────────── Constants ────────────────── */

/** Statuses that are subject to periodic rechecks. */
const RECHECKABLE_STATUSES = ["VERIFIED", "LIVE_UNVERIFIED", "ATTESTED"] as const;

/** How often to recheck (30 days per §6.2). */
const RECHECK_INTERVAL_DAYS = 30;

/** Maximum artifacts to queue per scheduler run. */
const BATCH_SIZE = 100;

/* ────────────────── Recheck runner ────────────────── */

/**
 * Finds artifacts due for recheck and enqueues them.
 * Called by the maintenance worker when task = "recheck_evidence".
 */
export async function runRecheckScheduler(): Promise<{ queued: number; skipped: number }> {
  const cutoff = new Date(Date.now() - RECHECK_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

  // Find artifacts that:
  // 1. Are in a recheckable status
  // 2. Were last verified/checked before the cutoff
  // 3. Have a source URL (can be re-checked)
  const dueArtifacts = await db
    .select({
      id: artifacts.id,
      status: artifacts.status,
      type: artifacts.type,
      sourceUrl: artifacts.sourceUrl,
    })
    .from(artifacts)
    .where(
      and(
        inArray(artifacts.status, [...RECHECKABLE_STATUSES]),
        or(
          lt(artifacts.verifiedAt, cutoff),
          // Also pick up artifacts that have never had verifiedAt set
          // (shouldn't happen for VERIFIED, but defensive)
          sql`${artifacts.verifiedAt} IS NULL`,
        ),
        sql`${artifacts.sourceUrl} IS NOT NULL AND ${artifacts.sourceUrl} != ''`,
      ),
    )
    .limit(BATCH_SIZE);

  let queued = 0;
  let skipped = 0;

  for (const a of dueArtifacts) {
    // Determine the verification kind from the artifact
    const kind = inferVerificationKind(a.type, a.sourceUrl);
    if (!kind) {
      skipped++;
      continue;
    }

    try {
      await enqueue(
        "verification",
        {
          artifactId: a.id,
          kind,
          attempt: 1,
        },
        `recheck-${a.id}`, // dedup by artifact ID
      );
      queued++;
    } catch (err) {
      // BullMQ throws if a job with this ID already exists — that's fine
      logger.debug({ artifactId: a.id, err: String(err) }, "recheck already queued");
      skipped++;
    }
  }

  logger.info(
    { queued, skipped, total: dueArtifacts.length, cutoffDate: cutoff.toISOString() },
    "recheck scheduler run complete",
  );

  return { queued, skipped };
}

/* ────────────────── Recheck outcome handler ────────────────── */

/**
 * Handles the outcome of a recheck. Called after a verification worker
 * processes a recheck job.
 *
 * §15 rules:
 * - STALE after one failed recheck
 * - UNVERIFIED after two consecutive failures
 * - Back to VERIFIED after a passing recheck
 */
export async function handleRecheckOutcome(
  artifactId: string,
  passed: boolean,
  reason: string,
): Promise<{ newStatus: string }> {
  const [a] = await db
    .select({ id: artifacts.id, status: artifacts.status })
    .from(artifacts)
    .where(eq(artifacts.id, artifactId))
    .limit(1);

  if (!a) return { newStatus: "unknown" };

  const currentStatus = a.status;

  if (passed) {
    // Successful recheck: restore to VERIFIED
    if (currentStatus === "STALE") {
      try {
        await transitionArtifact(
          {
            artifactId,
            toStatus: "VERIFIED",
            actorId: "recheck-worker",
            actorKind: "system",
            reason: `Recheck passed: ${reason}`,
            expectedFromStatus: "STALE",
          },
          getRealDeps(),
        );
        return { newStatus: "VERIFIED" };
      } catch (err) {
        if (err instanceof LifecycleError) {
          logger.warn({ artifactId, code: err.code }, "recheck transition skipped");
        }
        return { newStatus: currentStatus };
      }
    }
    // Already VERIFIED or other status — no-op
    return { newStatus: currentStatus };
  }

  // Failed recheck
  if (currentStatus === "VERIFIED" || currentStatus === "LIVE_UNVERIFIED" || currentStatus === "ATTESTED") {
    // First failure → STALE
    try {
      const targetStatus = "STALE";
      await transitionArtifact(
        {
          artifactId,
          toStatus: targetStatus,
          actorId: "recheck-worker",
          actorKind: "system",
          reason: `Recheck failed (1st): ${reason}`,
        },
        getRealDeps(),
      );
      return { newStatus: "STALE" };
    } catch (err) {
      if (err instanceof LifecycleError) {
        logger.warn({ artifactId, code: err.code }, "recheck transition skipped");
      }
      return { newStatus: currentStatus };
    }
  }

  if (currentStatus === "STALE") {
    // Second failure → UNVERIFIED
    try {
      await transitionArtifact(
        {
          artifactId,
          toStatus: "UNVERIFIED",
          actorId: "recheck-worker",
          actorKind: "system",
          reason: `Recheck failed (2nd consecutive): ${reason}`,
          expectedFromStatus: "STALE",
        },
        getRealDeps(),
      );
      return { newStatus: "UNVERIFIED" };
    } catch (err) {
      if (err instanceof LifecycleError) {
        logger.warn({ artifactId, code: err.code }, "recheck transition skipped");
      }
      return { newStatus: currentStatus };
    }
  }

  return { newStatus: currentStatus };
}

/* ────────────────── Kind inference ────────────────── */

function inferVerificationKind(_artifactKind: string, sourceUrl: string | null): "github" | "crossref" | "link" | null {
  if (!sourceUrl) return null;
  const url = sourceUrl.toLowerCase();

  if (url.includes("github.com")) return "github";
  if (url.includes("doi.org") || url.startsWith("10.")) return "crossref";
  if (url.startsWith("http://") || url.startsWith("https://")) return "link";

  return null;
}
