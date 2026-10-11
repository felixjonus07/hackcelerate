/**
 * Scheduled evidence maintenance (§6.1, §6.2): re-check what is due, let lapsed attestations go
 * STALE, and sample external score reports each term. Run by the maintenance worker.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import { artifacts, mockAttempts } from "../db/schema";
import { getActivePolicy } from "../policy/load";
import { enqueue } from "../queue";
import { applyTransition } from "./apply";
import { doiFrom } from "./claims";
import type { VerifyKind } from "./index";
import { attestationExpired } from "./lifecycle";

/** Which automatic check an artifact needs, from its evidence type and link. */
export function verifyKindFor(
  a: { type: string; sourceUrl: string | null },
  catalog: Record<string, { verifier?: string }>,
): VerifyKind | null {
  const v = catalog[a.type]?.verifier;
  if (v === "github" || v === "link" || v === "certificate") return v;
  if (v === "crossref") return a.sourceUrl && doiFrom(a.sourceUrl) ? "crossref" : "link";
  if (!a.sourceUrl) return null;
  return /github\.com\//i.test(a.sourceUrl)
    ? "github"
    : doiFrom(a.sourceUrl) && /doi/i.test(a.sourceUrl)
      ? "crossref"
      : "link";
}

/** Queue a verification job for every artifact whose check is due (new, retrying or periodic). */
export async function queueDueRechecks(now = new Date()): Promise<number> {
  const policy = await getActivePolicy();
  const due = await db
    .select()
    .from(artifacts)
    .where(
      and(
        isNotNull(artifacts.nextCheckAt),
        lte(artifacts.nextCheckAt, now),
        inArray(artifacts.status, ["UNDER_CHECK", "VERIFIED", "LIVE_UNVERIFIED", "STALE"]),
      ),
    );
  let queued = 0;
  for (const a of due) {
    const kind = verifyKindFor(a, policy.evidence_types);
    if (!kind || kind === "certificate") continue;
    await enqueue("verification", { artifactId: a.id, kind }, `recheck-${a.id}-${now.toISOString().slice(0, 10)}`);
    queued++;
  }
  return queued;
}

/** Attestations lapse to STALE after their review period (§6.1). */
export async function expireAttestations(now = new Date()): Promise<number> {
  const policy = await getActivePolicy();
  const rows = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.status, "ATTESTED"), isNotNull(artifacts.attestedAt)));
  let n = 0;
  for (const a of rows) {
    if (!a.attestedAt || !attestationExpired(a.attestedAt, now, policy)) continue;
    await applyTransition(a.id, "STALE", { kind: "system" }, "The attestation's review period has passed", { now });
    n++;
  }
  return n;
}

/** Deterministic 0–1 value from a key, so the same term always samples the same reports. */
export const sampleValue = (key: string) =>
  Number.parseInt(createHash("sha256").update(key).digest("hex").slice(0, 8), 16) / 0xffffffff;

/**
 * Pick the share of external score reports to check against the test body this term (§6.2).
 * Reports are chosen by hashing their id with the term, so a rerun picks the same ones.
 */
export async function sampleExternalMocks(termKey: string, now = new Date()): Promise<number> {
  const policy = await getActivePolicy();
  const rows = await db
    .select()
    .from(mockAttempts)
    .where(and(eq(mockAttempts.status, "SELF_REPORTED"), isNull(mockAttempts.sampledAt)));
  const picked = rows.filter((m) => sampleValue(`${termKey}:${m.id}`) < policy.verification.external_mock_sample_rate);
  for (const m of picked) await db.update(mockAttempts).set({ sampledAt: now }).where(eq(mockAttempts.id, m.id));
  await audit({
    actorUserId: "system",
    actorRole: "system",
    action: "mock.sample_external",
    entityType: "term",
    entityId: termKey,
    purpose: "evidence_verification",
    fieldsAccessed: [`candidates:${rows.length}`, `sampled:${picked.length}`],
    result: "allowed",
  });
  return picked.length;
}
