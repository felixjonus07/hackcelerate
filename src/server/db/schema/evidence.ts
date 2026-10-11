/** Evidence and execution signals (§4.1, §6). */
import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    /**
     * Normalised identity of what is claimed (repository, DOI, certificate id), so the same claim
     * made by two students is found (§6.3 duplicate claim).
     */
    claimKey: text("claim_key"),
    /** Hash of the normalised description, for reused-text detection (§6.3). */
    textHash: text("text_hash"),
    /** When the next automatic re-check is due (§6.2); null for items that are not re-checked. */
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    /** When a named reviewer attested the item; attestations lapse after a review period. */
    attestedAt: timestamp("attested_at", { withTimezone: true }),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("artifacts_student_idx").on(t.studentId),
    index("artifacts_hash_idx").on(t.contentHash),
    index("artifacts_claim_idx").on(t.claimKey),
    index("artifacts_text_hash_idx").on(t.textHash),
    index("artifacts_next_check_idx").on(t.nextCheckAt),
  ],
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
  (t) => [
    index("attendance_student_week_idx").on(t.studentId, t.weekStart),
    // One row per student, course and week, so a re-import replaces instead of duplicating (§6.2).
    uniqueIndex("attendance_unique_week").on(t.studentId, t.course, t.weekStart),
  ],
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
    /** The test's score range (§4.3): a score outside 0–maxScore is stored but flagged. */
    maxScore: numeric("max_score", { precision: 6, scale: 2, mode: "number" }).notNull().default(100),
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
    /** Difficulty band of a timed set, for the speed score (§5.3.4). */
    difficulty: text("difficulty"),
    /** External reports are sampled each term and checked against the test body (§6.2). */
    sampledAt: timestamp("sampled_at", { withTimezone: true }),
    /** MATCH | MISMATCH, set by the reviewer who checked the sampled report. */
    sampleOutcome: text("sample_outcome"),
    /** Why the attempt is excluded from percentile scoring (§4.3), if it is. */
    qualityFlag: text("quality_flag"),
    /** Raw answers; kept 12 months, scores stay with the record (§13.5). */
    rawAnswers: jsonb("raw_answers").$type<unknown>(),
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

export const integrityFlags = pgTable("integrity_flags", {
  /** One flag per (check, subject, student): re-running a check never raises the same flag twice. */
  dedupeKey: text("dedupe_key").unique(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Self-set milestones with due and completion dates (§5.3.2 application timeline, §5.3.3 venture milestones). */
export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    /** application | venture */
    scope: text("scope").notNull(),
    title: text("title").notNull(),
    dueOn: date("due_on").notNull(),
    completedOn: date("completed_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("milestones_student_idx").on(t.studentId, t.scope)],
);

/**
 * Platform activity with timestamps: study sessions, practice, logins. Feeds the 60-day activity
 * count (§7.3), the current-affairs days (§5.3.4) and the wellbeing patterns (§14.2).
 * Holds no content, only that something happened and how many items it covered.
 */
export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull(),
    /** login | current_affairs | practice | mock */
    kind: text("kind").notNull(),
    items: integer("items").notNull().default(0),
  },
  (t) => [index("activity_student_at_idx").on(t.studentId, t.at)],
);
