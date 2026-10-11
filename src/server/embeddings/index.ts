/**
 * Embeddings for pgvector matching (remediation library, opportunity feed).
 * Uses OpenRouter's OpenAI-compatible /embeddings endpoint. Returns null when
 * no key is configured, so callers fall back to rule-based matching.
 */
import { cosineDistance, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { remediationLibrary } from "../db/schema";
import { env, llmEnabled } from "../env";

export async function embed(text: string): Promise<number[] | null> {
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
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { embedding: number[] }[] };
  return body.data?.[0]?.embedding ?? null;
}

export async function embedRemediationRow(id: string) {
  const [row] = await db.select().from(remediationLibrary).where(eq(remediationLibrary.id, id)).limit(1);
  if (!row) return;
  const v = await embed(`${row.title}. ${row.action}`);
  if (v) await db.update(remediationLibrary).set({ embedding: v }).where(eq(remediationLibrary.id, id));
}

/** Nearest remediation items to a free-text gap description (cosine distance). */
export async function nearestRemediation(gapText: string, limit = 3) {
  const v = await embed(gapText);
  if (!v) return [];
  const distance = sql<number>`${cosineDistance(remediationLibrary.embedding, v)}`;
  return db
    .select({
      id: remediationLibrary.id,
      title: remediationLibrary.title,
      distance,
    })
    .from(remediationLibrary)
    .where(isNotNull(remediationLibrary.embedding))
    .orderBy(distance)
    .limit(limit);
}
