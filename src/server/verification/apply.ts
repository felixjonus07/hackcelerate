/**
 * Applies a status transition to an artifact (§6.1): validated against the lifecycle table and the
 * actor, written with its reason to `artifact_status_events`, and audited with the actor and reason.
 */
import { eq } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import { artifactStatusEvents, artifacts } from "../db/schema";
import { getActivePolicy } from "../policy/load";
import type { VerificationStatus } from "../policy/schema";
import { type Actor, assertTransition, nextCheckAfter } from "./lifecycle";

export interface ActorRef {
  kind: Actor;
  userId?: string;
  role?: string;
}

export type CheckKind = "github" | "crossref" | "link" | "certificate" | "platform" | "reviewer";

export async function applyTransition(
  artifactId: string,
  to: VerificationStatus,
  actor: ActorRef,
  reason: string,
  opts: { now?: Date; checkKind?: CheckKind; sourceIp?: string | null } = {},
) {
  const policy = await getActivePolicy();
  const now = opts.now ?? new Date();
  const result = await db.transaction(async (tx) => {
    const [a] = await tx.select().from(artifacts).where(eq(artifacts.id, artifactId)).for("update");
    if (!a) throw new Error("Artifact not found");
    assertTransition(a.status, to, actor.kind);
    const [row] = await tx
      .update(artifacts)
      .set({
        status: to,
        ...(to === "VERIFIED" ? { verifiedAt: now } : {}),
        ...(to === "ATTESTED" ? { attestedAt: now } : {}),
        ...(actor.kind !== "student" ? { lastCheckedAt: now } : {}),
        nextCheckAt: nextCheckAfter(to, opts.checkKind ?? "reviewer", now, policy),
      })
      .where(eq(artifacts.id, artifactId))
      .returning();
    await tx.insert(artifactStatusEvents).values({
      artifactId,
      fromStatus: a.status,
      toStatus: to,
      actorUserId: actor.userId ?? null,
      actorKind: actor.kind,
      reason,
      at: now,
    });
    return { from: a.status, row };
  });
  // A quest named this artifact as its evidence: a counted artifact completes it (§8.3).
  const { settleQuestForArtifact } = await import("../services/quests");
  await settleQuestForArtifact(artifactId, now).catch(() => undefined);
  await audit({
    actorUserId: actor.userId ?? actor.kind,
    actorRole: actor.role ?? actor.kind,
    action: "artifact.status_change",
    entityType: "artifact",
    entityId: artifactId,
    purpose: "evidence_verification",
    reason,
    fieldsAccessed: [`status:${result.from}->${to}`],
    sourceIp: opts.sourceIp,
    result: "allowed",
  });
  return result;
}
