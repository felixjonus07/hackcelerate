import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { redis } from "@/server/cache/redis";
import { db } from "@/server/db";

/** Liveness + dependency check for Postgres and Redis. */
export async function GET() {
  await connection();
  const checks: Record<string, "ok" | "down"> = {};
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("db timeout")), 2000)),
    ]);
    checks.postgres = "ok";
  } catch {
    checks.postgres = "down";
  }
  try {
    if (redis.status === "wait") {
      await Promise.race([
        redis.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("connect timeout")), 1500)),
      ]);
    }
    const pong = await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("ping timeout")), 1500)),
    ]);
    checks.redis = pong === "PONG" ? "ok" : "down";
  } catch {
    checks.redis = "down";
  }
  const ok = Object.values(checks).every((v) => v === "ok");
  return Response.json({ status: ok ? "ok" : "degraded", checks }, { status: ok ? 200 : 503 });
}
