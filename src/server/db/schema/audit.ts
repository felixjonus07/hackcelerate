/** Append-only audit log (§13.6, Appendix E). A DB trigger rejects UPDATE/DELETE. */
import { index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
    /** Free-text reason for the action, e.g. why an evidence status changed (§6.1). */
    reason: text("reason"),
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

/**
 * One row per ERP import attempt (§6.2). status: OK | UNCHANGED (same checksum as the
 * previous night) | PARTIAL (some rows rejected) | SCHEMA_ERROR | FILE_MISSING | FAILED.
 */
export const ingestionRuns = pgTable("ingestion_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(),
  fileName: text("file_name"),
  fileChecksum: text("file_checksum"),
  rowsTotal: integer("rows_total").notNull().default(0),
  rowsAccepted: integer("rows_accepted").notNull().default(0),
  rowsRejected: integer("rows_rejected").notNull().default(0),
  status: text("status").notNull(),
  errors: jsonb("errors").$type<string[]>().notNull().default([]),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/**
 * Outbox for everything the platform tells a person: in-app notices, digests, and (when a transport is
 * configured) email or WhatsApp (§10.1). Rows are written in the same transaction as the event that
 * caused them; a worker delivers them. No message holds free text about a person's wellbeing.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The person it is for, when a specific user; otherwise it goes to everyone in `recipientRole`. */
    recipientUserId: text("recipient_user_id"),
    recipientRole: text("recipient_role"),
    /** The student it concerns, so role-addressed notices reach only that student's staff. */
    studentId: uuid("student_id"),
    channel: text("channel").notNull().default("in_app"),
    template: text("template").notNull(),
    payload: jsonb("payload").$type<Record<string, string | number>>().notNull().default({}),
    /** PENDING | SENT | FAILED | SKIPPED */
    status: text("status").notNull().default("PENDING"),
    relatedType: text("related_type"),
    relatedId: text("related_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    index("notifications_user_idx").on(t.recipientUserId, t.status),
    index("notifications_role_idx").on(t.recipientRole, t.status),
  ],
);

/** Audit events past their retention period, moved here and restricted to auditors (§13.5). Same shape as the live log. */
export const auditEventsArchive = pgTable("audit_events_archive", {
  id: uuid("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  actorUserId: text("actor_user_id").notNull(),
  actorRole: text("actor_role").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  purpose: text("purpose").notNull(),
  reason: text("reason"),
  fieldsAccessed: jsonb("fields_accessed").$type<string[]>().notNull().default([]),
  policyVersion: text("policy_version").notNull(),
  sourceIp: text("source_ip"),
  result: text("result").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Counts kept after evaluations are deleted 12 months after graduation: "aggregate statistics kept" (§13.5). */
export const cohortAggregates = pgTable("cohort_aggregates", {
  id: uuid("id").primaryKey().defaultRandom(),
  period: text("period").notNull(),
  department: text("department").notNull(),
  track: text("track").notNull(),
  aegIndex: text("aeg_index").notNull(),
  students: integer("students").notNull(),
  meanScore: numeric("mean_score", { precision: 7, scale: 4, mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
