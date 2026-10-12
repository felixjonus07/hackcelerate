/**
 * Helpers for tests that need the real Postgres (triggers, constraints, SQL).
 * They skip when the database is unreachable, so `npm run check` still works on a
 * laptop without Docker; CI sets REQUIRE_DB=1 so a missing database fails the run.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

export async function dbAvailable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1 from evaluations limit 1`);
    return true;
  } catch {
    if (process.env.REQUIRE_DB) throw new Error("REQUIRE_DB is set but the database is not reachable");
    return false;
  }
}

class Rollback extends Error {}

/** Run `fn` in a transaction that is always rolled back, so tests leave no trace. */
export async function inRollback<T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) {
  let out: T | undefined;
  try {
    await db.transaction(async (tx) => {
      out = await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out as T;
}

/** The Postgres error message behind a Drizzle "Failed query" wrapper. */
export function pgMessage(e: unknown): string {
  const cause = (e as { cause?: { message?: string } })?.cause;
  return cause?.message ?? (e instanceof Error ? e.message : String(e));
}

/** Resolves with the Postgres error message of a query that is expected to fail. */
export async function failure(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return pgMessage(e);
  }
  throw new Error("expected the query to fail, but it succeeded");
}
