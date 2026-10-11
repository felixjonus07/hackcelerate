import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../index";
import { auditEvents, evaluations } from "../schema";

function formatError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const errorObj = err as { message?: string; cause?: { message?: string } };
  return `${errorObj.message ?? ""} ${errorObj.cause?.message ?? ""}`;
}

describe("§4.1 and §13.6 Append-Only Immutability Guards", () => {
  it("rejects UPDATE on evaluations via PostgreSQL trigger", async () => {
    const [ev] = await db.select().from(evaluations).limit(1);
    if (!ev) return;

    let thrown: unknown = null;
    try {
      await db.update(evaluations).set({ trackScore: 99.99 }).where(sql`id = ${ev.id}`);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).not.toBeNull();
    expect(formatError(thrown)).toMatch(/table is append-only/);
  });

  it("rejects DELETE on evaluations without allow_erasure setting", async () => {
    const [ev] = await db.select().from(evaluations).limit(1);
    if (!ev) return;

    let thrown: unknown = null;
    try {
      await db.delete(evaluations).where(sql`id = ${ev.id}`);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).not.toBeNull();
    expect(formatError(thrown)).toMatch(/table is append-only/);
  });

  it("rejects UPDATE and DELETE on audit_events", async () => {
    const [audit] = await db.select().from(auditEvents).limit(1);
    if (!audit) return;

    let updateThrown: unknown = null;
    try {
      await db.update(auditEvents).set({ action: "tampered.action" }).where(sql`id = ${audit.id}`);
    } catch (e) {
      updateThrown = e;
    }
    expect(updateThrown).not.toBeNull();
    expect(formatError(updateThrown)).toMatch(/table is append-only/);

    let deleteThrown: unknown = null;
    try {
      await db.delete(auditEvents).where(sql`id = ${audit.id}`);
    } catch (e) {
      deleteThrown = e;
    }
    expect(deleteThrown).not.toBeNull();
    expect(formatError(deleteThrown)).toMatch(/table is append-only/);
  });
});
