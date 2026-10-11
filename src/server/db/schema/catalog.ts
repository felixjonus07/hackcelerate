/**
 * Opportunity feed and remediation library (§3.2, §9.1), with pgvector
 * embeddings for matching a student's data gaps to concrete next steps.
 */
import { index, integer, pgTable, text, timestamp, uuid, vector } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { trackEnum } from "./enums";

export const EMBEDDING_DIMENSIONS = 1536;

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    track: trackEnum("track").notNull(),
    type: text("type").notNull(), // exam | internship | camp | competition | workshop
    title: text("title").notNull(),
    description: text("description"),
    sourceUrl: text("source_url").notNull(),
    deadline: timestamp("deadline", { withTimezone: true }),
    verifiedBy: text("verified_by").references(() => user.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("opportunities_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops"))],
);

export const remediationLibrary = pgTable(
  "remediation_library",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    track: trackEnum("track").notNull(),
    departmentCode: text("department_code"),
    componentKey: text("component_key").notNull(),
    standardItem: text("standard_item"),
    title: text("title").notNull(),
    action: text("action").notNull(),
    defaultTargetDays: integer("default_target_days").notNull(),
    requiredEvidenceType: text("required_evidence_type").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
  },
  (t) => [index("remediation_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops"))],
);
