/**
 * The database enforces append-only history itself (§4.1, §13.6): evaluations,
 * audit events, consent history, status events and card moves reject UPDATE and
 * DELETE, whatever the application code does.
 */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ME_27 } from "../../rules/fixtures";
import { dbAvailable, failure, inRollback } from "../../testing/db";
import { insertEvaluation, insertStudent } from "../../testing/fixtures";
import { db } from "../index";
import { auditEvents, consentRecords } from "../schema";

const up = await dbAvailable();

const GUARDED = [
  "audit_events",
  "consent_records",
  "evaluations",
  "artifact_status_events",
  "counseling_card_moves",
] as const;

describe.skipIf(!up)("append-only guards", () => {
  it.each(GUARDED)("%s has its append-only trigger", async (table) => {
    const rows = await db.execute<{ tgname: string }>(
      sql`select tgname from pg_trigger where tgrelid = ${table}::regclass and not tgisinternal`,
    );
    expect(rows.map((r) => r.tgname)).toContain(`${table}_${table === "evaluations" ? "immutable" : "append_only"}`);
  });

  /** Each statement runs in a savepoint, so one expected failure does not abort the rest. */
  const attempt = (tx: Parameters<Parameters<typeof inRollback>[0]>[0], statement: ReturnType<typeof sql>) =>
    failure(tx.transaction((t) => t.execute(statement)));

  it("evaluations are immutable once written", async () => {
    await inRollback(async (tx) => {
      const s = await insertStudent(tx);
      const e = await insertEvaluation(tx, s.id, ME_27);
      expect(await attempt(tx, sql`update evaluations set fallback = not fallback where id = ${e.id}`)).toMatch(
        /append-only/,
      );
      expect(await attempt(tx, sql`delete from evaluations where id = ${e.id}`)).toMatch(/append-only/);
    });
  });

  it("audit events cannot be changed or removed", async () => {
    await inRollback(async (tx) => {
      const [a] = await tx
        .insert(auditEvents)
        .values({
          actorUserId: "t",
          actorRole: "auditor",
          action: "test",
          entityType: "x",
          entityId: "1",
          purpose: "test",
          policyVersion: "t",
          result: "allowed",
        })
        .returning();
      expect(await attempt(tx, sql`update audit_events set result = 'denied' where id = ${a.id}`)).toMatch(
        /append-only/,
      );
      expect(await attempt(tx, sql`delete from audit_events where id = ${a.id}`)).toMatch(/append-only/);
    });
  });

  it("consent history cannot be rewritten", async () => {
    await inRollback(async (tx) => {
      const s = await insertStudent(tx);
      const [c] = await tx
        .insert(consentRecords)
        .values({ studentId: s.id, category: "academic_baseline", recipientRole: "placement_officer", granted: true })
        .returning();
      expect(await attempt(tx, sql`update consent_records set granted = false where id = ${c.id}`)).toMatch(
        /append-only/,
      );
    });
  });

  it("lets an erasure job delete, but only with the explicit setting, and never update", async () => {
    await inRollback(async (tx) => {
      const [a] = await tx
        .insert(auditEvents)
        .values({
          actorUserId: "t",
          actorRole: "auditor",
          action: "test",
          entityType: "x",
          entityId: "2",
          purpose: "test",
          policyVersion: "t",
          result: "allowed",
        })
        .returning();
      expect(await attempt(tx, sql`delete from audit_events where id = ${a.id}`)).toMatch(/append-only/);
      await tx.execute(sql`set local aspiredge.allow_erasure = 'on'`);
      expect(await attempt(tx, sql`update audit_events set result = 'x' where id = ${a.id}`)).toMatch(/append-only/);
      await tx.execute(sql`delete from audit_events where id = ${a.id}`);
      const left = await tx.execute(sql`select 1 from audit_events where id = ${a.id}`);
      expect(left).toHaveLength(0);
    });
  });
});
