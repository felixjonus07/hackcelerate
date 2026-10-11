/** Append-only audit log (§13.6, Appendix E). A DB trigger rejects UPDATE/DELETE. */
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: text("actor_user_id").notNull(),
    actorRole: text("actor_role").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    purpose: text("purpose").notNull(),
    fieldsAccessed: jsonb("fields_accessed").$type<string[]>().notNull().default([]),
    policyVersion: text("policy_version").notNull(),
    sourceIp: text("source_ip"),
    result: text("result").notNull(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId, t.at),
    index("audit_actor_idx").on(t.actorUserId, t.at),
  ],
);

export const ingestionRuns = pgTable("ingestion_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(),
  fileChecksum: text("file_checksum"),
  rowsTotal: text("rows_total"),
  rowsRejected: text("rows_rejected"),
  status: text("status").notNull(),
  errors: jsonb("errors").$type<string[]>().notNull().default([]),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});
