/**
 * A deterministic stand-in for the embeddings API: hashes words into a fixed-size
 * vector, so texts that share words are close under cosine distance. Lets tests
 * exercise pgvector ranking without a network call or an API key.
 */
import { createHash } from "node:crypto";
import { EMBEDDING_DIMENSIONS } from "../db/schema/catalog";
import type { Embedder } from "../embeddings";

const STOP = new Set(["the", "a", "an", "of", "to", "and", "in", "for", "on", "your", "you", "with"]);

export const fakeEmbedder: Embedder = async (text) => {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9&]+/g) ?? []) {
    if (STOP.has(word)) continue;
    const h = createHash("sha256").update(word).digest();
    v[h.readUInt16BE(0) % EMBEDDING_DIMENSIONS] += 1;
    v[h.readUInt16BE(2) % EMBEDDING_DIMENSIONS] += 0.5;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
};
