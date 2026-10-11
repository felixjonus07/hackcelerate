/** Evidence and execution signals (§4.1, §6). */
import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { verificationStatusEnum } from "./enums";
import { students } from "./people";

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    /** repository | doi | portfolio | certificate | letter | medal | client_reference | lab_record | test */
    type: text("type").notNull(),
    component: text("component").notNull(),
    standardItem: text("standard_item"),
    label: text("label").notNull(),
    /** Student-written description — untrusted input (§9.2). */
    description: text("description"),
    sourceUrl: text("source_url"),
    fileRef: text("file_ref"),
    source: text("source").notNull(),
    status: verificationStatusEnum("status").notNull().default("SUBMITTED"),
    weight: numeric("weight", { precision: 5, scale: 2, mode: "number" }).notNull().default(1),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    contentHash: text("content_hash"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("artifacts_student_idx").on(t.studentId), index("artifacts_hash_idx").on(t.contentHash)],
);

/** Append-only history of status transitions (§6.1). */
export const artifactStatusEvents = pgTable("artifact_status_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  artifactId: uuid("artifact_id")
    .notNull()
    .references(() => artifacts.id, { onDelete: "cascade" }),
  fromStatus: verificationStatusEnum("from_status"),
  toStatus: verificationStatusEnum("to_status").notNull(),
  actorUserId: text("actor_user_id").references(() => user.id),
  actorKind: text("actor_kind").notNull(),
  reason: text("reason").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const attendanceWeeks = pgTable(
  "attendance_weeks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    course: text("course").notNull(),
    weekStart: date("week_start").notNull(),
    classesHeld: integer("classes_held").notNull(),
    classesAttended: integer("classes_attended").notNull(),
  },
  (t) => [index("attendance_student_week_idx").on(t.studentId, t.weekStart)],
);

export const mockAttempts = pgTable(
  "mock_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    testType: text("test_type").notNull(),
    items: integer("items").notNull(),
    score: numeric("score", {
      precision: 6,
      scale: 2,
      mode: "number",
    }).notNull(),
    percentile: numeric("percentile", {
      precision: 5,
      scale: 2,
      mode: "number",
    }).notNull(),
    avgSecondsPerItem: numeric("avg_seconds_per_item", {
      precision: 7,
      scale: 2,
      mode: "number",
    }).notNull(),
    targetSecondsPerItem: numeric("target_seconds_per_item", {
      precision: 7,
      scale: 2,
      mode: "number",
    }),
    itemKind: text("item_kind"),
    source: text("source").notNull(),
    status: verificationStatusEnum("status").notNull(),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("mocks_student_idx").on(t.studentId, t.takenAt)],
);

export const facultyRatings = pgTable("faculty_ratings", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  raterUserId: text("rater_user_id").references(() => user.id),
  kind: text("kind").notNull(),
  rating: numeric("rating", {
    precision: 3,
    scale: 2,
    mode: "number",
  }).notNull(),
  status: verificationStatusEnum("status").notNull().default("ATTESTED"),
  ratedAt: timestamp("rated_at", { withTimezone: true }).notNull(),
});

export const internshipRecords = pgTable("internship_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  organisation: text("organisation").notNull(),
  hours: integer("hours").notNull(),
  status: verificationStatusEnum("status").notNull().default("SUBMITTED"),
  confirmedBy: text("confirmed_by").references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const integrityFlags = pgTable(
  "integrity_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    check: text("check").notNull(),
    subjectId: text("subject_id").notNull(),
    detail: text("detail").notNull(),
    status: text("status").notNull().default("OPEN"),
    resolvedBy: text("resolved_by").references(() => user.id),
    resolution: text("resolution"),
    /** Related student IDs for cross-student flags (duplicate claim, reused text). */
    relatedStudentIds: jsonb("related_student_ids").$type<string[]>().notNull().default([]),
    /** Policy thresholds that triggered the flag. */
    ruleParams: jsonb("rule_params").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("integrity_flags_student_idx").on(t.studentId, t.status)],
);

/** Verification attempt records (§6.2). Persists what was checked, when, and the outcome. */
export const verificationAttempts = pgTable(
  "verification_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // github | crossref | link | certificate
    status: text("status").notNull(), // success | failure | inconclusive | error
    reason: text("reason").notNull(),
    /** Non-sensitive metadata from the verification provider. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    /** Whether this was a scheduled recheck. */
    isRecheck: integer("is_recheck").notNull().default(0),
    /** The business-level recheck failure count BEFORE this attempt. */
    recheckFailuresBefore: integer("recheck_failures_before").notNull().default(0),
    retryable: integer("retryable").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("verification_attempts_artifact_idx").on(t.artifactId, t.startedAt)],
);

/** 10% external mock sampling decisions (§6.2). */
export const samplingDecisions = pgTable(
  "sampling_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The mock attempt or evidence record being considered. */
    candidateId: text("candidate_id").notNull(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    selected: integer("selected").notNull(), // 1 = selected, 0 = not selected
    selectionHash: text("selection_hash").notNull(),
    /** Status of external verification if selected. */
    verificationStatus: text("verification_status").default("PENDING"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sampling_term_idx").on(t.term, t.selected),
    index("sampling_candidate_idx").on(t.candidateId, t.term),
  ],
);
