/**
 * Database client (Drizzle + postgres.js). Safe to import from Next.js server
 * code and from BullMQ workers alike (no `server-only` here).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  pg?: ReturnType<typeof postgres>;
};

const url = process.env.DATABASE_URL ?? "postgres://aspiredge:aspiredge@localhost:5434/aspiredge";
const isLocal = url.includes("localhost") || url.includes("127.0.0.1");

export const pg =
  globalForDb.pg ??
  postgres(url, {
    max: 10,
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 20,
    ssl: isLocal ? undefined : "require",
  });
if (process.env.NODE_ENV !== "production") globalForDb.pg = pg;

export const db = drizzle(pg, { schema, casing: "snake_case" });
export type Db = typeof db;
export { schema };
