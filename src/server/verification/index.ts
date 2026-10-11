/**
 * Verification orchestrator: routes artifacts through source-specific
 * checks and applies status transitions via the authoritative lifecycle.
 *
 * Called by BullMQ workers. All transitions go through transitionArtifact()
 * to enforce the §6.1 lifecycle, actor identity, and audit.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { artifactStatusEvents, artifacts } from "../db/schema";
import { students, studentIdentities } from "../db/schema/people";
import type { VerificationStatus } from "../policy/schema";
import { logger } from "../logger";
import { verifyCrossref } from "./crossref";
import { verifyGitHub } from "./github";
import { transitionArtifact, getRealDeps, LifecycleError } from "./lifecycle";
import { checkLink } from "./link";

/* ────────────────── Types ────────────────── */

export interface VerificationOutcome {
  artifactId: string;
  previousStatus: VerificationStatus;
  newStatus: VerificationStatus;
  reason: string;
  retryable: boolean;
  needsReview: boolean;
  metadata?: Record<string, unknown>;
}

/* ────────────────── Helper: safe transition ────────────────── */

async function safeTransition(
  artifactId: string,
  currentStatus: VerificationStatus,
  targetStatus: VerificationStatus,
  workerId: string,
  reason: string,
): Promise<void> {
  try {
    await transitionArtifact(
      {
        artifactId,
        toStatus: targetStatus,
        actorId: workerId,
        actorKind: "system",
        reason,
        expectedFromStatus: currentStatus,
      },
      getRealDeps(),
    );
  } catch (err) {
    if (err instanceof LifecycleError && err.code === "ALREADY_IN_TARGET_STATUS") {
      // Idempotent — already at the target status, likely a retry
      return;
    }
    throw err;
  }
}

/* ────────────────── Main verification function ────────────────── */

/**
 * Verifies an artifact based on its type. This function is called by the
 * BullMQ verification worker.
 *
 * @param artifactId - The artifact to verify
 * @param kind - The verification method to use
 * @param attempt - Current attempt number (for retry tracking)
 */
export async function verifyArtifact(
  artifactId: string,
  kind: "github" | "crossref" | "link" | "certificate",
  attempt = 1,
): Promise<VerificationOutcome> {
  // 1. Load artifact
  const [a] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, artifactId))
    .limit(1);

  if (!a) {
    return {
      artifactId,
      previousStatus: "SUBMITTED",
      newStatus: "SUBMITTED",
      reason: "Artifact not found",
      retryable: false,
      needsReview: false,
    };
  }

  let status = a.status as VerificationStatus;

  // 2. Move to UNDER_CHECK if currently SUBMITTED
  if (status === "SUBMITTED") {
    await safeTransition(a.id, status, "UNDER_CHECK", `${kind}-worker`, "Queued for automatic check");
    status = "UNDER_CHECK";
  }

  // 3. If no source URL and not a certificate/letter, mark as SELF_REPORTED
  if (!a.sourceUrl && kind !== "certificate") {
    await safeTransition(a.id, status, "SELF_REPORTED", `${kind}-worker`, "No checkable source URL provided");
    return {
      artifactId: a.id,
      previousStatus: status,
      newStatus: "SELF_REPORTED",
      reason: "No checkable source",
      retryable: false,
      needsReview: false,
    };
  }

  // 4. Load student info for name matching (crossref, link)
  let studentName = "";
  if (kind === "crossref" || kind === "link") {
    const [identity] = await db
      .select({ displayName: studentIdentities.displayName })
      .from(studentIdentities)
      .where(eq(studentIdentities.studentId, a.studentId))
      .limit(1);
    studentName = identity?.displayName ?? "";
  }

  // 5. Route to the appropriate verifier
  try {
    if (kind === "github") {
      return await verifyGitHubArtifact(a, status);
    }
    if (kind === "crossref") {
      return await verifyCrossrefArtifact(a, status, studentName);
    }
    if (kind === "link") {
      return await verifyLinkArtifact(a, status, studentName);
    }
    if (kind === "certificate") {
      // Certificates require human review — mark as awaiting reviewer
      await safeTransition(a.id, status, "SELF_REPORTED", "certificate-worker", "Awaiting named reviewer attestation");
      return {
        artifactId: a.id,
        previousStatus: status,
        newStatus: "SELF_REPORTED",
        reason: "Certificate/letter awaiting reviewer attestation",
        retryable: false,
        needsReview: true,
      };
    }

    return {
      artifactId: a.id,
      previousStatus: status,
      newStatus: status,
      reason: `Unknown verification kind: ${kind}`,
      retryable: false,
      needsReview: true,
    };
  } catch (err) {
    logger.error(
      { artifactId: a.id, kind, attempt, err: err instanceof Error ? err.message : String(err) },
      "verification failed",
    );
    return {
      artifactId: a.id,
      previousStatus: status,
      newStatus: status,
      reason: `Verification error: ${err instanceof Error ? err.message : "Unknown error"}`,
      retryable: true,
      needsReview: false,
    };
  }
}

/* ────────────────── GitHub verification ────────────────── */

type ArtifactRow = typeof artifacts.$inferSelect;

async function verifyGitHubArtifact(
  artifact: ArtifactRow,
  currentStatus: VerificationStatus,
): Promise<VerificationOutcome> {
  const url = artifact.sourceUrl;
  if (!url) {
    return makeOutcome(artifact.id, currentStatus, currentStatus, "No source URL", false, false);
  }

  // Get the expected GitHub login from the artifact details if available
  const expectedLogin = (artifact.details as Record<string, unknown>)?.githubLogin as string | undefined;
  const expectedEmail = (artifact.details as Record<string, unknown>)?.githubEmail as string | undefined;

  const result = await verifyGitHub(url, expectedLogin, expectedEmail);

  let targetStatus: VerificationStatus;

  if (result.verified) {
    targetStatus = "VERIFIED";
  } else if (result.needsReview) {
    targetStatus = "LIVE_UNVERIFIED";
  } else if (result.retryable) {
    // Don't change status for retryable errors
    return makeOutcome(artifact.id, currentStatus, currentStatus, result.reason, true, false, {
      errorCategory: result.errorCategory,
      metadata: result.metadata,
    });
  } else {
    targetStatus = "UNVERIFIED";
  }

  await safeTransition(artifact.id, currentStatus, targetStatus, "github-worker", result.reason);

  return makeOutcome(artifact.id, currentStatus, targetStatus, result.reason, false, result.needsReview, {
    metadata: result.metadata,
    authorship: result.authorship,
  });
}

/* ────────────────── Crossref verification ────────────────── */

async function verifyCrossrefArtifact(
  artifact: ArtifactRow,
  currentStatus: VerificationStatus,
  studentName: string,
): Promise<VerificationOutcome> {
  const url = artifact.sourceUrl;
  if (!url) {
    return makeOutcome(artifact.id, currentStatus, currentStatus, "No DOI provided", false, false);
  }

  const result = await verifyCrossref(url, studentName);

  let targetStatus: VerificationStatus;

  if (result.verified) {
    targetStatus = "VERIFIED";
  } else if (result.needsReview) {
    // Name variants → route to mentor review as LIVE_UNVERIFIED
    targetStatus = "LIVE_UNVERIFIED";
  } else if (result.retryable) {
    return makeOutcome(artifact.id, currentStatus, currentStatus, result.reason, true, false, {
      errorCategory: result.errorCategory,
    });
  } else {
    targetStatus = "UNVERIFIED";
  }

  await safeTransition(artifact.id, currentStatus, targetStatus, "crossref-worker", result.reason);

  return makeOutcome(artifact.id, currentStatus, targetStatus, result.reason, false, result.needsReview, {
    metadata: result.metadata,
    nameMatch: result.nameMatch,
  });
}

/* ────────────────── Link verification ────────────────── */

async function verifyLinkArtifact(
  artifact: ArtifactRow,
  currentStatus: VerificationStatus,
  studentName: string,
): Promise<VerificationOutcome> {
  const url = artifact.sourceUrl;
  if (!url) {
    return makeOutcome(artifact.id, currentStatus, currentStatus, "No URL provided", false, false);
  }

  const result = await checkLink(url, studentName || undefined);

  let targetStatus: VerificationStatus;

  if (result.loginWall) {
    // §6.2: Login-only pages become LIVE_UNVERIFIED
    targetStatus = "LIVE_UNVERIFIED";
  } else if (result.live && result.ownerMatched) {
    targetStatus = "VERIFIED";
  } else if (result.live) {
    targetStatus = "LIVE_UNVERIFIED";
  } else if (result.retryable) {
    return makeOutcome(artifact.id, currentStatus, currentStatus, result.reason, true, false, {
      errorCategory: result.errorCategory,
    });
  } else {
    targetStatus = "UNVERIFIED";
  }

  await safeTransition(artifact.id, currentStatus, targetStatus, "link-worker", result.reason);

  return makeOutcome(artifact.id, currentStatus, targetStatus, result.reason, false, false, {
    httpStatus: result.httpStatus,
  });
}

/* ────────────────── Helper ────────────────── */

function makeOutcome(
  artifactId: string,
  previousStatus: VerificationStatus,
  newStatus: VerificationStatus,
  reason: string,
  retryable: boolean,
  needsReview: boolean,
  extra?: Record<string, unknown>,
): VerificationOutcome {
  return {
    artifactId,
    previousStatus,
    newStatus,
    reason,
    retryable,
    needsReview,
    metadata: extra,
  };
}
