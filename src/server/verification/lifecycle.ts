/**
 * Evidence status lifecycle (§6.1). This is the single authoritative module
 * for evidence-status transitions. Every transition writes an audit trail
 * entry atomically and enforces actor authorization + concurrency safety.
 *
 * All status-changing code paths MUST use `transitionArtifact()`. Direct
 * status updates on the artifacts table are forbidden.
 */
import { and, eq } from "drizzle-orm";
import type { VerificationStatus } from "../policy/schema";

/* ───────────────────── Transition table (§6.1) ───────────────────── */

/**
 * Allowed transitions extracted from Section 6.1 of the reference plan.
 *
 * | From            | Allowed next states                                               | Set by              |
 * |-----------------|-------------------------------------------------------------------|---------------------|
 * | SUBMITTED       | UNDER_CHECK                                                       | System              |
 * | UNDER_CHECK     | VERIFIED, LIVE_UNVERIFIED, SELF_REPORTED, UNVERIFIED, ATTESTED, REJECTED | System / Reviewer |
 * | ATTESTED        | REJECTED, STALE                                                   | Reviewer / System   |
 * | VERIFIED        | STALE                                                             | System              |
 * | STALE           | VERIFIED, UNVERIFIED                                              | System              |
 * | LIVE_UNVERIFIED | VERIFIED, STALE, UNVERIFIED                                       | System              |
 * | SELF_REPORTED   | UNDER_CHECK, ATTESTED, REJECTED                                   | System / Reviewer   |
 * | UNVERIFIED      | SUBMITTED                                                         | Student (resubmit)  |
 * | REJECTED        | SUBMITTED                                                         | Student (resubmit)  |
 */
export const TRANSITIONS: Record<VerificationStatus, VerificationStatus[]> = {
  SUBMITTED: ["UNDER_CHECK"],
  UNDER_CHECK: ["VERIFIED", "LIVE_UNVERIFIED", "SELF_REPORTED", "UNVERIFIED", "ATTESTED", "REJECTED"],
  ATTESTED: ["REJECTED", "STALE"],
  VERIFIED: ["STALE"],
  STALE: ["VERIFIED", "UNVERIFIED"],
  LIVE_UNVERIFIED: ["VERIFIED", "STALE", "UNVERIFIED"],
  SELF_REPORTED: ["UNDER_CHECK", "ATTESTED", "REJECTED"],
  UNVERIFIED: ["SUBMITTED"],
  REJECTED: ["SUBMITTED"],
};

export function canTransition(from: VerificationStatus, to: VerificationStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/* ─────────────── Actor kinds allowed per transition target ─────────────── */

/**
 * Who can set each target status. "system" = background worker / scheduler.
 * "reviewer" = a named human reviewer (faculty, officer, cell).
 * "student"  = the student who owns the artifact (resubmit only).
 */
export type ActorKind = "system" | "reviewer" | "student";

const ACTOR_RULES: Record<VerificationStatus, ActorKind[]> = {
  SUBMITTED: ["student"],
  UNDER_CHECK: ["system"],
  VERIFIED: ["system"],
  LIVE_UNVERIFIED: ["system"],
  SELF_REPORTED: ["system"],
  UNVERIFIED: ["system"],
  REJECTED: ["system", "reviewer"],
  ATTESTED: ["reviewer"],
  STALE: ["system"],
};

/* ───────────────── Typed request / result / errors ───────────────── */

export interface TransitionRequest {
  /** The artifact being transitioned. */
  artifactId: string;
  /** The target status. */
  toStatus: VerificationStatus;
  /** Actor identity — user ID or "system:<worker-name>". */
  actorId: string;
  /** Actor kind for authorization. */
  actorKind: ActorKind;
  /** Human-readable reason for the transition. */
  reason: string;
  /** Correlation ID for linking to a verification attempt. */
  correlationId?: string;
  /**
   * Expected current status for optimistic concurrency control.
   * If provided, the transition is rejected when the DB status differs.
   */
  expectedFromStatus?: VerificationStatus;
}

export interface TransitionResult {
  artifactId: string;
  fromStatus: VerificationStatus;
  toStatus: VerificationStatus;
  auditEventId: string;
}

export class LifecycleError extends Error {
  constructor(
    public readonly code:
      | "ARTIFACT_NOT_FOUND"
      | "INVALID_TRANSITION"
      | "UNAUTHORIZED_ACTOR"
      | "MISSING_REASON"
      | "CONCURRENT_MODIFICATION"
      | "ALREADY_IN_TARGET_STATUS",
    message: string,
  ) {
    super(message);
    this.name = "LifecycleError";
  }
}

/* ─────────────── The authoritative transition function ─────────────── */

/**
 * Validates and applies an artifact-status transition atomically.
 *
 * 1. Loads the artifact's current status.
 * 2. Validates the transition against the allowed table.
 * 3. Validates actor authorization.
 * 4. Updates the artifact with an optimistic concurrency check.
 * 5. Inserts an append-only status event.
 * 6. All within a single Drizzle transaction.
 *
 * @throws LifecycleError on validation or concurrency failure.
 */
export async function transitionArtifact(req: TransitionRequest, deps: TransitionDeps): Promise<TransitionResult> {
  // 1. Validate reason is not empty.
  if (!req.reason || req.reason.trim().length === 0) {
    throw new LifecycleError("MISSING_REASON", "A transition reason is required");
  }

  return deps.db.transaction(async (tx) => {
    // 2. Load current artifact with a row-level lock (FOR UPDATE).
    const [artifact] = await tx
      .select({
        id: deps.artifacts.id,
        status: deps.artifacts.status,
      })
      .from(deps.artifacts)
      .where(eq(deps.artifacts.id, req.artifactId))
      .for("update")
      .limit(1);

    if (!artifact) {
      throw new LifecycleError("ARTIFACT_NOT_FOUND", `Artifact ${req.artifactId} not found`);
    }

    const fromStatus = artifact.status as VerificationStatus;

    // 3. Optimistic concurrency check (if caller specified expected status).
    if (req.expectedFromStatus && fromStatus !== req.expectedFromStatus) {
      throw new LifecycleError(
        "CONCURRENT_MODIFICATION",
        `Expected status ${req.expectedFromStatus} but found ${fromStatus}`,
      );
    }

    // 4. Idempotent: already in target status.
    if (fromStatus === req.toStatus) {
      throw new LifecycleError("ALREADY_IN_TARGET_STATUS", `Artifact is already ${req.toStatus}`);
    }

    // 5. Validate the transition is in the allowed table.
    if (!canTransition(fromStatus, req.toStatus)) {
      throw new LifecycleError("INVALID_TRANSITION", `Transition ${fromStatus} → ${req.toStatus} is not allowed`);
    }

    // 6. Validate actor kind.
    const allowedActors = ACTOR_RULES[req.toStatus];
    if (!allowedActors.includes(req.actorKind)) {
      throw new LifecycleError(
        "UNAUTHORIZED_ACTOR",
        `Actor kind "${req.actorKind}" cannot set status to ${req.toStatus}; allowed: ${allowedActors.join(", ")}`,
      );
    }

    // 7. Apply the status update with a conditional WHERE to double-check concurrency.
    const updateResult = await tx
      .update(deps.artifacts)
      .set({
        status: req.toStatus,
        verifiedAt: req.toStatus === "VERIFIED" ? new Date() : undefined,
      })
      .where(and(eq(deps.artifacts.id, req.artifactId), eq(deps.artifacts.status, fromStatus)))
      .returning({ id: deps.artifacts.id });

    if (updateResult.length === 0) {
      throw new LifecycleError("CONCURRENT_MODIFICATION", `Artifact ${req.artifactId} status changed concurrently`);
    }

    // 8. Write the append-only status event.
    const [event] = await tx
      .insert(deps.artifactStatusEvents)
      .values({
        artifactId: req.artifactId,
        fromStatus,
        toStatus: req.toStatus,
        actorUserId: req.actorKind !== "system" ? req.actorId : null,
        actorKind: req.actorKind === "system" ? `system:${req.actorId}` : req.actorKind,
        reason: req.reason.trim(),
      })
      .returning({ id: deps.artifactStatusEvents.id });

    return {
      artifactId: req.artifactId,
      fromStatus,
      toStatus: req.toStatus,
      auditEventId: event.id,
    };
  });
}

/* ────── Dependency injection for testability (avoids importing db) ────── */

/**
 * Dependencies injected by the caller so the lifecycle module can be tested
 * without a live database and workers can use it without `server-only`.
 */
export interface TransitionDeps {
  // biome-ignore lint/suspicious/noExplicitAny: generic drizzle transaction
  db: { transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T> };
  // biome-ignore lint/suspicious/noExplicitAny: generic drizzle schema
  artifacts: any;
  // biome-ignore lint/suspicious/noExplicitAny: generic drizzle schema
  artifactStatusEvents: any;
}

/* ──────────── Convenience: create deps from the real db ──────────── */

let _cachedDeps: TransitionDeps | null = null;

/**
 * Returns transition deps using the real database. Lazy-loaded to avoid
 * circular imports and `server-only` issues in workers.
 */
export function getRealDeps(): TransitionDeps {
  if (_cachedDeps) return _cachedDeps;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { db } = require("../db") as typeof import("../db");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { artifacts, artifactStatusEvents } =
    require("../db/schema/evidence") as typeof import("../db/schema/evidence");
  const deps: TransitionDeps = {
    db: db as unknown as TransitionDeps["db"],
    artifacts,
    artifactStatusEvents,
  };
  _cachedDeps = deps;
  return deps;
}
