/**
 * Embeddings for pgvector matching (§9.1: action plans are constrained to the
 * remediation library and linked opportunities). The OpenRouter embedder returns
 * null when no key is configured, so every caller has a rule-based fallback and
 * the system works the same, less smartly, without a key.
 */
import { and, cosineDistance, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { opportunities, remediationLibrary } from "../db/schema";
import { env, llmEnabled } from "../env";

export type Embedder = (text: string) => Promise<number[] | null>;

export const embed: Embedder = async (text) => {
  if (!llmEnabled) return null;
  const res = await fetch(`${env.OPENROUTER_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENROUTER_EMBEDDING_MODEL,
      input: text,
      dimensions: env.EMBEDDING_DIMENSIONS,
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const body = (await res.json()) as { data?: { embedding: number[] }[] };
  return body.data?.[0]?.embedding ?? null;
};

export async function embedRemediationRow(id: string, embedder: Embedder = embed) {
  const [row] = await db.select().from(remediationLibrary).where(eq(remediationLibrary.id, id)).limit(1);
  if (!row) return false;
  const v = await embedder(`${row.title}. ${row.action}`);
  if (v) await db.update(remediationLibrary).set({ embedding: v }).where(eq(remediationLibrary.id, id));
  return Boolean(v);
}

export async function embedOpportunityRow(id: string, embedder: Embedder = embed) {
  const [row] = await db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
  if (!row) return false;
  const v = await embedder(`${row.title}. ${row.description ?? row.type}`);
  if (v) await db.update(opportunities).set({ embedding: v }).where(eq(opportunities.id, id));
  return Boolean(v);
}

/** Embed every catalog row that has no vector yet. Skips quietly when no embedder is available. */
export async function embedMissing(embedder: Embedder = embed) {
  const rem = await db
    .select({ id: remediationLibrary.id })
    .from(remediationLibrary)
    .where(isNull(remediationLibrary.embedding));
  const opp = await db.select({ id: opportunities.id }).from(opportunities).where(isNull(opportunities.embedding));
  let remediation = 0;
  let opps = 0;
  for (const r of rem) if (await embedRemediationRow(r.id, embedder)) remediation++;
  for (const o of opp) if (await embedOpportunityRow(o.id, embedder)) opps++;
  return { remediation, opportunities: opps, pending: rem.length + opp.length - remediation - opps };
}

/**
 * Cosine distance (0 = identical) from `gapText` to each of the given remediation
 * rows that has a vector. Null when no embedder is available, so the caller falls back to rules.
 */
export async function remediationDistances(
  candidateIds: string[],
  gapText: string,
  embedder: Embedder = embed,
): Promise<Map<string, number> | null> {
  if (candidateIds.length === 0) return new Map();
  const v = await embedder(gapText);
  if (!v) return null;
  const distance = sql<number>`${cosineDistance(remediationLibrary.embedding, v)}`;
  const rows = await db
    .select({ id: remediationLibrary.id, distance })
    .from(remediationLibrary)
    .where(and(inArray(remediationLibrary.id, candidateIds), isNotNull(remediationLibrary.embedding)));
  return new Map(rows.map((r) => [r.id, Number(r.distance)]));
}

/** Nearest remediation items to a free-text gap description (cosine distance). */
export async function nearestRemediation(gapText: string, limit = 3, embedder: Embedder = embed) {
  const v = await embedder(gapText);
  if (!v) return [];
  const distance = sql<number>`${cosineDistance(remediationLibrary.embedding, v)}`;
  return db
    .select({ id: remediationLibrary.id, title: remediationLibrary.title, distance })
    .from(remediationLibrary)
    .where(isNotNull(remediationLibrary.embedding))
    .orderBy(distance)
    .limit(limit);
}

/**
 * The best open opportunity on a track for a quest (§3.2: dates come only from the
 * verified feed). Only verified opportunities that have not passed their deadline qualify.
 */
export async function nearestOpportunity(track: string, text: string, now: Date, embedder: Embedder = embed) {
  const v = await embedder(text);
  if (!v) return null;
  const distance = sql<number>`${cosineDistance(opportunities.embedding, v)}`;
  const [row] = await db
    .select({ id: opportunities.id, title: opportunities.title, distance })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.track, track as typeof opportunities.$inferSelect.track),
        isNotNull(opportunities.embedding),
        isNotNull(opportunities.verifiedAt),
        or(isNull(opportunities.deadline), gt(opportunities.deadline, now)),
      ),
    )
    .orderBy(distance)
    .limit(1);
  return row ?? null;
}
