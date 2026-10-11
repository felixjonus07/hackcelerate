/**
 * Verification job: runs the source-specific check and moves the artifact
 * through the lifecycle, writing an audit trail entry for each transition.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { artifactStatusEvents, artifacts } from "../db/schema";
import type { VerificationStatus } from "../policy/schema";
import { checkRepository } from "./github";
import { canTransition } from "./lifecycle";
import { checkLink } from "./link";

async function transition(artifactId: string, from: VerificationStatus, to: VerificationStatus, reason: string) {
  if (!canTransition(from, to)) throw new Error(`Illegal transition ${from} → ${to}`);
  await db.transaction(async (tx) => {
    await tx
      .update(artifacts)
      .set({ status: to, verifiedAt: to === "VERIFIED" ? new Date() : null })
      .where(eq(artifacts.id, artifactId));
    await tx.insert(artifactStatusEvents).values({
      artifactId,
      fromStatus: from,
      toStatus: to,
      actorKind: "system",
      reason,
    });
  });
}

export async function verifyArtifact(artifactId: string, kind: "github" | "crossref" | "link" | "certificate") {
  const [a] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
  if (!a) return;
  let status = a.status;
  if (status === "SUBMITTED") {
    await transition(a.id, status, "UNDER_CHECK", "Queued for automatic check");
    status = "UNDER_CHECK";
  }
  if (!a.sourceUrl) return transition(a.id, status, "SELF_REPORTED", "No checkable source");
  if (kind === "github") {
    const r = await checkRepository(a.sourceUrl);
    return transition(
      a.id,
      status,
      r.ok && !r.fork ? "VERIFIED" : r.ok ? "LIVE_UNVERIFIED" : "UNVERIFIED",
      r.reason ?? "GitHub API confirmed the repository",
    );
  }
  if (kind === "link") {
    const r = await checkLink(a.sourceUrl);
    return transition(
      a.id,
      status,
      r.live ? (r.ownerMatched ? "VERIFIED" : "LIVE_UNVERIFIED") : "UNVERIFIED",
      r.live ? "Link is live" : "Link not reachable",
    );
  }
  // crossref and certificates need the student's name / a named reviewer: Phase 3.
  return transition(a.id, status, "SELF_REPORTED", `${kind} check awaits reviewer (Phase 3)`);
}
