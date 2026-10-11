/**
 * Redis client shared by the cache helpers and BullMQ. BullMQ requires
 * `maxRetriesPerRequest: null` on its connections.
 */
import Redis, { type RedisOptions } from "ioredis";
import { env } from "../env";

const globalForRedis = globalThis as unknown as { redis?: Redis };

export function createRedis(opts: RedisOptions = {}) {
  return new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    ...opts,
  });
}

export const redis = globalForRedis.redis ?? createRedis();
if (env.NODE_ENV !== "production") globalForRedis.redis = redis;
