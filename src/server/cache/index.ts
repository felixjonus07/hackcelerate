/**
 * Small JSON cache over Redis. Used for LLM narratives keyed by
 * hash(facts, policy version, prompt version) (§9.5) and cohort summaries.
 * Fails open: a Redis outage never breaks a request.
 */
import { createHash } from "node:crypto";
import { redis } from "./redis";

export const hashKey = (...parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // fail open
  }
}

export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await load();
  await cacheSet(key, value, ttlSeconds);
  return value;
}
