/**
 * Redis as Better Auth's secondary storage: sessions and rate-limit counters
 * live here (reads always hit Redis; the DB keeps a copy for listing and audit).
 */
import type { BetterAuthOptions } from "better-auth";
import { redis } from "../cache/redis";

const PREFIX = "ba:";

export const redisSecondaryStorage: NonNullable<BetterAuthOptions["secondaryStorage"]> = {
  get: (key) => redis.get(PREFIX + key).catch(() => null),
  getAndDelete: (key) => redis.getdel(PREFIX + key).catch(() => null),
  async increment(key, ttl) {
    try {
      const n = await redis.incr(PREFIX + key);
      if (n === 1) await redis.expire(PREFIX + key, ttl);
      return n;
    } catch {
      return 1;
    }
  },
  set: (key, value, ttl) =>
    (ttl ? redis.set(PREFIX + key, value, "EX", Math.max(1, Math.ceil(ttl))) : redis.set(PREFIX + key, value))
      .then(() => "OK" as const)
      .catch(() => "OK" as const),
  delete: (key) =>
    redis
      .del(PREFIX + key)
      .then(() => undefined)
      .catch(() => undefined),
};
