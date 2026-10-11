/** Students, departments, aspirations and staff assignments (§4.1). */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { roleEnum, trackEnum } from "./enums";

/**
 * Cohort-derived signals refreshed nightly (§7.3): the verified artifact score and the cohort's 75th
 * percentile. Everything else the rubrics read comes straight from the base tables. A key listed in
 * `pinned` is left alone by the refresh (the seed pins the plan's worked examples).
 */
export interface StudentSignals {
  artifactScore?: number | null;
  cohortArtifactP75?: number | null;
  recentSourceFailures?: number;
  pinned?: string[];
}

export const departments = pgTable("departments", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  standardsVersion: text("standards_version").notNull(),
});

export const students = pgTable(
  "students",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .unique()
      .references(() => user.id, { onDelete: "set null" }),
    /** Used in analytics, LLM requests and staff lists (§4.1, §9.4). */
    pseudonymousId: text("pseudonymous_id").notNull().unique(),
    departmentCode: text("department_code")
      .notNull()
      .references(() => departments.code),
    year: integer("year").notNull(),
    batch: text("batch").notNull(),
    declaredTrack: trackEnum("declared_track"),
    cgpa: numeric("cgpa", { precision: 4, scale: 2, mode: "number" }),
    attendancePct: numeric("attendance_pct", {
      precision: 5,
      scale: 2,
      mode: "number",
    }),
    activeBacklogs: integer("active_backlogs").notNull().default(0),
    dateOfBirth: date("date_of_birth"),
    /** Credits held, from the ERP; the Sports, Defense and NCC gate reads it (§5.3.6). */
    creditsHeld: integer("credits_held"),
    /** GitHub login proven by OAuth, so repository ownership can be confirmed (§6.2). */
    /** Set when the student has finished onboarding (§12.1); step is the card they are on. */
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    onboardingStep: integer("onboarding_step").notNull().default(0),
    /** Graduation date; evaluations are retained 12 months after it (§13.5). */
    graduatedOn: date("graduated_on"),
    githubLogin: text("github_login"),
    githubLinkedAt: timestamp("github_linked_at", { withTimezone: true }),
    /** When the last ERP import touched this record; `erpStale` is set when a night's file was missing (§6.2). */
    erpImportedAt: timestamp("erp_imported_at", { withTimezone: true }),
    erpStale: boolean("erp_stale").notNull().default(false),
    isSynthetic: boolean("is_synthetic").notNull().default(false),
    /**
     * Snapshot of ingestion-derived signals the rubric reads (activity counts,
     * cohort percentiles, track-specific recorded scores). Rewritten nightly.
     */
    signals: jsonb("signals").$type<StudentSignals>().notNull().default({}),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("students_dept_idx").on(t.departmentCode, t.year)],
);

/** Restricted: roll numbers live apart from the pseudonymous record (§4.1). */
export const studentIdentities = pgTable("student_identities", {
  studentId: uuid("student_id")
    .primaryKey()
    .references(() => students.id, { onDelete: "cascade" }),
  rollNumber: text("roll_number").notNull().unique(),
  displayName: text("display_name").notNull(),
});

export const aspirations = pgTable(
  "aspirations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    track: trackEnum("track"),
    targetOutcome: text("target_outcome").notNull(),
    targetType: text("target_type"),
    targetDate: date("target_date"),
    readiness: integer("readiness").notNull().default(70),
    isCurrent: boolean("is_current").notNull().default(true),
    changeReason: text("change_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("aspirations_student_idx").on(t.studentId, t.isCurrent)],
);

export const staffAssignments = pgTable(
  "staff_assignments",
  {
    staffUserId: text("staff_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.staffUserId, t.studentId, t.role] })],
);

/** Staff profile: department scope for HOD/dean/officers. */
export const staffProfiles = pgTable("staff_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  departmentCode: text("department_code").references(() => departments.code),
  title: text("title"),
});
