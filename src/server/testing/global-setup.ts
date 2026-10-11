/**
 * Vitest global setup: a throwaway `aspiredge_test` database on the same Postgres
 * as local development (created if missing, migrated, truncated), so integration
 * tests can write freely without touching the seeded demo data.
 * Without a reachable Postgres the tests that need it skip (see testing/db.ts).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://aspiredge:aspiredge@localhost:5434/aspiredge_test";

export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  try {
    const root = postgres(admin.toString(), { max: 1, connect_timeout: 3, onnotice: () => undefined });
    const exists = await root`select 1 from pg_database where datname = ${dbName}`;
    if (exists.length === 0) await root.unsafe(`create database "${dbName}"`);
    await root.end();

    const sql = postgres(url.toString(), { max: 1, connect_timeout: 3, onnotice: () => undefined });
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
    await sql.unsafe(`
      do $$ declare r record; begin
        for r in select tablename from pg_tables where schemaname = 'public' loop
          execute 'truncate table ' || quote_ident(r.tablename) || ' restart identity cascade';
        end loop;
      end $$`);
    await sql.end();
  } catch (e) {
    console.warn(
      `[tests] Postgres is not available (${e instanceof Error ? e.message : e}); database tests will skip.`,
    );
  }
}
