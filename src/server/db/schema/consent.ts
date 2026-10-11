/** Consent history (append-only; current state = latest row) and leaderboard opt-in (§4.1, §12.1). */
import {
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { consentCategoryEnum, roleEnum } from "./enums";
import { students } from "./people";

export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    category: consentCategoryEnum("category").notNull(),
    recipientRole: roleEnum("recipient_role").notNull(),
    granted: boolean("granted").notNull(),
    changedBy: text("changed_by").references(() => user.id),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("consent_lookup_idx").on(t.studentId, t.category, t.recipientRole, t.changedAt)],
);

export const leaderboardOptIns = pgTable("leaderboard_opt_ins", {
  studentId: uuid("student_id")
    .primaryKey()
    .references(() => students.id, { onDelete: "cascade" }),
  optedIn: boolean("opted_in").notNull().default(false),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The plain-language notice a student acknowledged, by version (§12.1 card 1, §13.4). */
export const noticeAcknowledgements = pgTable(
  "notice_acknowledgements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notice_ack_unique").on(t.studentId, t.version)],
);

/** A behavioural recovery nudge shown to the student, with the pattern that triggered it (§14.2). Never a label. */
export const wellbeingNudges = pgTable(
  "wellbeing_nudges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    /** late_night | volume_spike | activity_stop */
    pattern: text("pattern").notNull(),
    detectedOn: date("detected_on").notNull(),
    /** The counts behind it, in words the student can read. */
    explanation: text("explanation").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("wellbeing_student_idx").on(t.studentId, t.createdAt)],
);

/** Where a person wants digests: email by default, WhatsApp only on explicit opt-in (§10.1). */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    optedIn: boolean("opted_in").notNull().default(false),
    /** Phone number for WhatsApp; kept only while opted in. */
    destination: text("destination"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channel] })],
);

export const rightsRequests = pgTable("rights_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // access | correction | erasure
  detail: text("detail"),
  status: text("status").notNull().default("OPEN"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  resolution: text("resolution"),
  /** Who handles it: the registrar for ERP data, the mentor of record for a narrative (§13.7). */
  routedToRole: text("routed_to_role"),
  /** For erasure: what is erased now and what is kept, with the reason (§13.7). */
  plan: jsonb("plan").$type<unknown>(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Verifiable parental consent for a student under 18 (§4.3, §13.4). Nothing about the student is processed
 * (no evaluation, no dispatch) until a registrar records a VERIFIED consent; REVOKED stops processing again.
 */
export const parentalConsents = pgTable("parental_consents", {
  studentId: uuid("student_id")
    .primaryKey()
    .references(() => students.id, { onDelete: "cascade" }),
  /** PENDING | VERIFIED | REVOKED */
  status: text("status").notNull().default("PENDING"),
  /** How the guardian was verified, e.g. signed form checked against the admission record. */
  method: text("method"),
  verifiedBy: text("verified_by").references(() => user.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Demographic fields for the fairness analysis only (§14.1): collected with consent, stored apart from the
 * student record, never read by the rules engine, and reported only for groups of at least 20.
 */
export const demographicProfiles = pgTable("demographic_profiles", {
  studentId: uuid("student_id")
    .primaryKey()
    .references(() => students.id, { onDelete: "cascade" }),
  mediumOfInstruction: text("medium_of_instruction"),
  firstGeneration: boolean("first_generation"),
  homeRegion: text("home_region"),
  gender: text("gender"),
  deviceAccess: text("device_access"),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
});
