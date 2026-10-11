/** Consent history (append-only; current state = latest row) and leaderboard opt-in (§4.1, §12.1). */
import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
