/**
 * Idle-timeout tracking. Each active session has a Redis key whose TTL is the
 * idle timeout; every authenticated request renews it. A missing key means the
 * session went idle and must be revoked. Fails closed: if Redis is down the
 * session is treated as expired.
 */
import { redis } from "../cache/redis";
import type { SessionPolicy } from "./session-policy";

const key = (sessionId: string) => `sess:act:${sessionId}`;

export interface ActivityRecord {
  idleSeconds: number;
  absoluteSeconds: number;
  warningSeconds: number;
  trusted: boolean;
  role: string;
}

export async function startActivity(sessionId: string, role: string, p: SessionPolicy) {
  const rec: ActivityRecord = { ...p, role };
  await redis.set(key(sessionId), JSON.stringify(rec), "EX", p.idleSeconds);
}

/** Renews the idle window. Returns the record, or null when the session has gone idle. */
export async function touchActivity(sessionId: string): Promise<ActivityRecord | null> {
  try {
    const raw = await redis.get(key(sessionId));
    if (!raw) return null;
    const rec = JSON.parse(raw) as ActivityRecord;
    await redis.expire(key(sessionId), rec.idleSeconds);
    return rec;
  } catch {
    return null;
  }
}

export async function endActivity(sessionId: string) {
  await redis.del(key(sessionId)).catch(() => undefined);
}
