/**
 * Redis client shared by the cache helpers and BullMQ. BullMQ requires
 * `maxRetriesPerRequest: null` on its connections.
 */
import Redis, { type RedisOptions } from "ioredis";
import { env } from "../env";

const globalForRedis = globalThis as unknown as { redis?: Redis };

export function createRedis(opts: RedisOptions = {}) {
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    connectTimeout: 3000,
    commandTimeout: 3000,
    enableOfflineQueue: true,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 100, 1000);
    },
    ...opts,
  });
  // Attach an error listener so connection drops or unavailable Redis instances
  // never trigger Node's unhandled 'error' event and crash the process.
  client.on("error", () => {
    // Handled silently to prevent process crash
  });
  return client;
}

export const redis = globalForRedis.redis ?? createRedis();
if (env.NODE_ENV !== "production") globalForRedis.redis = redis;
