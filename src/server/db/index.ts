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

export const pg = globalForDb.pg ?? postgres(url, { max: 10, prepare: false });
if (process.env.NODE_ENV !== "production") globalForDb.pg = pg;

export const db = drizzle(pg, { schema, casing: "snake_case" });
export type Db = typeof db;
export { schema };
