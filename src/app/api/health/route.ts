import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { redis } from "@/server/cache/redis";
import { db } from "@/server/db";

/** Liveness + dependency check for Postgres and Redis. */
export async function GET() {
  await connection();
  const checks: Record<string, "ok" | "down"> = {};
  try {
    await db.execute(sql`select 1`);
    checks.postgres = "ok";
  } catch {
    checks.postgres = "down";
  }
  try {
    if (redis.status === "wait") await redis.connect();
    checks.redis = (await redis.ping()) === "PONG" ? "ok" : "down";
  } catch {
    checks.redis = "down";
  }
  const ok = Object.values(checks).every((v) => v === "ok");
  return Response.json({ status: ok ? "ok" : "degraded", checks }, { status: ok ? 200 : 503 });
}
