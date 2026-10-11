/** Policy versions, evaluations, interventions, counseling, quests (§3, §4, §8). */
import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Evaluation as EngineEvaluation } from "../../rules/types";
import { user } from "./auth";
import {
  aegLevelEnum,
  confidenceEnum,
  counselingColumnEnum,
  interventionStatusEnum,
  personaEnum,
  policyStatusEnum,
  questStatusEnum,
  roleEnum,
  trackEnum,
  trendEnum,
} from "./enums";
import { students } from "./people";

export const policyVersions = pgTable("policy_versions", {
  version: text("version").primaryKey(),
  status: policyStatusEnum("status").notNull().default("DRAFT"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  document: jsonb("document").notNull(),
  createdBy: text("created_by").references(() => user.id),
  /** Two approvals required for persona changes (§3.3). */
  approvals: jsonb("approvals").$type<{ userId: string; role: string; at: string }[]>().notNull().default([]),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface StoredNarrative {
  risk_summary: string;
  department_context_analysis: string;
  prescriptive_action_plan: {
    step_number: number;
    title: string;
    action: string;
    target_days: number;
    evidence_refs: string[];
  }[];
  career_pivot_advisory: { reasoning: string };
  removedSentences?: { field: string; sentence: string; check: string }[];
  warnings?: string[];
}

/** Immutable once written (§4.1); a DB trigger rejects UPDATE/DELETE. */
export const evaluations = pgTable(
  "evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    policyVersion: text("policy_version").notNull(),
    engineVersion: text("engine_version").notNull(),
    modelProvider: text("model_provider"),
    modelVersion: text("model_version"),
    promptVersion: text("prompt_version"),
    inputHash: text("input_hash").notNull(),
    track: trackEnum("track").notNull(),
    trackScore: numeric("track_score", {
      precision: 7,
      scale: 4,
      mode: "number",
    }).notNull(),
    readiness: integer("readiness").notNull(),
    gapRatio: numeric("gap_ratio", {
      precision: 7,
      scale: 4,
      mode: "number",
    }).notNull(),
    gapIndex: aegLevelEnum("gap_index").notNull(),
    aegIndex: aegLevelEnum("aeg_index").notNull(),
    primaryPersona: personaEnum("primary_persona"),
    trend: trendEnum("trend").notNull(),
    confidence: confidenceEnum("confidence").notNull(),
    result: jsonb("result").$type<EngineEvaluation>().notNull(),
    narrative: jsonb("narrative").$type<StoredNarrative>(),
    fallback: boolean("fallback").notNull().default(true),
    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("evaluations_student_idx").on(t.studentId, t.createdAt)],
);

/** Created only as PENDING_APPROVAL; cannot be sent without a decision (§4.1). */
export const interventions = pgTable(
  "interventions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evaluationId: uuid("evaluation_id")
      .notNull()
      .references(() => evaluations.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    routeKey: text("route_key").notNull(),
    recipientRole: roleEnum("recipient_role").notNull(),
    approverRole: roleEnum("approver_role").notNull(),
    copyRoles: jsonb("copy_roles").$type<string[]>().notNull().default([]),
    status: interventionStatusEnum("status").notNull().default("PENDING_APPROVAL"),
    queued: boolean("queued").notNull().default(false),
    proposedMessage: text("proposed_message").notNull(),
    finalMessage: text("final_message"),
    approverUserId: text("approver_user_id").references(() => user.id),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }).notNull(),
    closureRule: text("closure_rule").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("interventions_status_idx").on(t.status, t.approverRole)],
);

export const counselingCards = pgTable("counseling_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  interventionId: uuid("intervention_id").references(() => interventions.id),
  mentorUserId: text("mentor_user_id")
    .notNull()
    .references(() => user.id),
  column: counselingColumnEnum("column").notNull().default("REFERRED"),
  position: integer("position").notNull().default(0),
  nextDate: timestamp("next_date", { withTimezone: true }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const counselingCardMoves = pgTable("counseling_card_moves", {
  id: uuid("id").primaryKey().defaultRandom(),
  cardId: uuid("card_id")
    .notNull()
    .references(() => counselingCards.id, { onDelete: "cascade" }),
  fromColumn: counselingColumnEnum("from_column").notNull(),
  toColumn: counselingColumnEnum("to_column").notNull(),
  reason: text("reason"),
  actorUserId: text("actor_user_id")
    .notNull()
    .references(() => user.id),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const quests = pgTable("quests", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  evaluationId: uuid("evaluation_id").references(() => evaluations.id),
  title: text("title").notNull(),
  action: text("action").notNull(),
  targetDays: integer("target_days").notNull(),
  /** A quest closes only with evidence of this type (§8.3). */
  requiredEvidenceType: text("required_evidence_type").notNull(),
  componentKey: text("component_key"),
  standardItem: text("standard_item"),
  opportunityId: uuid("opportunity_id"),
  status: questStatusEnum("status").notNull().default("PROPOSED"),
  evidenceArtifactId: uuid("evidence_artifact_id"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
