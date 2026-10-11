import { pgEnum } from "drizzle-orm/pg-core";
import { AEG_LEVELS, PERSONA_IDS, TRACK_IDS, VERIFICATION_STATUSES } from "../../policy/schema";

export const ROLES = [
  "student",
  "faculty_mentor",
  "class_advisor",
  "hod",
  "dean",
  "placement_officer",
  "ecell_coordinator",
  "sports_officer",
  "registrar",
  "auditor",
  "alumni_mentor",
] as const;
export type Role = (typeof ROLES)[number];

export const roleEnum = pgEnum("role", ROLES);
export const trackEnum = pgEnum("track", TRACK_IDS);
export const aegLevelEnum = pgEnum("aeg_level", AEG_LEVELS);
export const personaEnum = pgEnum("persona", PERSONA_IDS);
export const verificationStatusEnum = pgEnum("verification_status", VERIFICATION_STATUSES);
export const confidenceEnum = pgEnum("confidence", ["HIGH", "MEDIUM", "LOW"]);
export const trendEnum = pgEnum("trend", ["IMPROVING", "STABLE", "WORSENING", "INSUFFICIENT_DATA"]);
export const policyStatusEnum = pgEnum("policy_status", ["DRAFT", "ACTIVE", "RETIRED"]);
export const interventionStatusEnum = pgEnum("intervention_status", [
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "DISPATCHED",
  "CLOSED",
]);
export const COUNSELING_COLUMNS = [
  "REFERRED",
  "SCHEDULED",
  "IN_CONVERSATION",
  "PLAN_ACTIVE",
  "FOLLOW_UP_DUE",
  "CLOSED",
] as const;
export const counselingColumnEnum = pgEnum("counseling_column", COUNSELING_COLUMNS);
export const QUEST_STATUSES = ["PROPOSED", "ACCEPTED", "ACTIVE", "EVIDENCE_SUBMITTED", "DONE", "EXPIRED"] as const;
export const questStatusEnum = pgEnum("quest_status", QUEST_STATUSES);
export const CONSENT_CATEGORIES = [
  "identity_contact",
  "academic_baseline",
  "mock_scores",
  "artifacts_evidence",
  "persona_aeg",
  "intervention_history",
] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];
export const consentCategoryEnum = pgEnum("consent_category", CONSENT_CATEGORIES);
