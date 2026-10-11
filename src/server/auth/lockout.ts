/**
 * Account lockout after repeated failed sign-ins (brute-force protection).
 * Keyed by a hash of the normalised email so unknown emails lock the same way
 * as real ones (no account enumeration) and raw emails never reach Redis.
 */
import { createHash } from "node:crypto";
import { redis } from "../cache/redis";
import { env } from "../env";

export const emailKey = (email: string) =>
  createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);

const failKey = (k: string) => `auth:fail:${k}`;
const lockKey = (k: string) => `auth:lock:${k}`;

/** Seconds until the lock lifts, or 0 when not locked. */
export async function lockedFor(email: string): Promise<number> {
  const ttl = await redis.ttl(lockKey(emailKey(email)));
  return ttl > 0 ? ttl : 0;
}

/** Records a failure; returns seconds locked if this failure triggered a lock, else 0. */
export async function recordFailure(email: string): Promise<number> {
  const k = emailKey(email);
  const windowSeconds = env.AUTH_LOCKOUT_MINUTES * 60;
  const n = await redis.incr(failKey(k));
  if (n === 1) await redis.expire(failKey(k), windowSeconds);
  if (n >= env.AUTH_MAX_FAILED_ATTEMPTS) {
    await redis.set(lockKey(k), "1", "EX", windowSeconds);
    await redis.del(failKey(k));
    return windowSeconds;
  }
  return 0;
}

export async function clearFailures(email: string) {
  await redis.del(failKey(emailKey(email)));
}
