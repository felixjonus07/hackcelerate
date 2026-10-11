CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TYPE "public"."aeg_level" AS ENUM('LOW', 'MODERATE', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."confidence" AS ENUM('HIGH', 'MEDIUM', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."consent_category" AS ENUM('identity_contact', 'academic_baseline', 'mock_scores', 'artifacts_evidence', 'persona_aeg', 'intervention_history');--> statement-breakpoint
CREATE TYPE "public"."counseling_column" AS ENUM('REFERRED', 'SCHEDULED', 'IN_CONVERSATION', 'PLAN_ACTIVE', 'FOLLOW_UP_DUE', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."intervention_status" AS ENUM('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'DISPATCHED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."persona" AS ENUM('detention_threat_builder', 'aspiration_mismatch', 'false_positive_high_flyer', 'drifting_student');--> statement-breakpoint
CREATE TYPE "public"."policy_status" AS ENUM('DRAFT', 'ACTIVE', 'RETIRED');--> statement-breakpoint
CREATE TYPE "public"."quest_status" AS ENUM('PROPOSED', 'ACCEPTED', 'ACTIVE', 'EVIDENCE_SUBMITTED', 'DONE', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('student', 'faculty_mentor', 'class_advisor', 'hod', 'dean', 'placement_officer', 'ecell_coordinator', 'sports_officer', 'registrar', 'auditor', 'alumni_mentor');--> statement-breakpoint
CREATE TYPE "public"."track" AS ENUM('corporate_placement', 'higher_studies', 'entrepreneurship', 'public_service', 'freelance_creator', 'sports_defense_ncc');--> statement-breakpoint
CREATE TYPE "public"."trend" AS ENUM('IMPROVING', 'STABLE', 'WORSENING', 'INSUFFICIENT_DATA');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('SUBMITTED', 'UNDER_CHECK', 'VERIFIED', 'ATTESTED', 'LIVE_UNVERIFIED', 'SELF_REPORTED', 'UNVERIFIED', 'REJECTED', 'STALE');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"purpose" text NOT NULL,
	"fields_accessed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_version" text NOT NULL,
	"source_ip" text,
	"result" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"file_checksum" text,
	"rows_total" text,
	"rows_rejected" text,
	"status" text NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "role" DEFAULT 'student' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track" "track" NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"source_url" text NOT NULL,
	"deadline" timestamp with time zone,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remediation_library" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track" "track" NOT NULL,
	"department_code" text,
	"component_key" text NOT NULL,
	"standard_item" text,
	"title" text NOT NULL,
	"action" text NOT NULL,
	"default_target_days" integer NOT NULL,
	"required_evidence_type" text NOT NULL,
	"embedding" vector(1536)
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"category" "consent_category" NOT NULL,
	"recipient_role" "role" NOT NULL,
	"granted" boolean NOT NULL,
	"changed_by" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaderboard_opt_ins" (
	"student_id" uuid PRIMARY KEY NOT NULL,
	"opted_in" boolean DEFAULT false NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rights_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"detail" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"due_at" timestamp with time zone,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"from_status" "verification_status",
	"to_status" "verification_status" NOT NULL,
	"actor_user_id" text,
	"actor_kind" text NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"type" text NOT NULL,
	"component" text NOT NULL,
	"standard_item" text,
	"label" text NOT NULL,
	"description" text,
	"source_url" text,
	"file_ref" text,
	"source" text NOT NULL,
	"status" "verification_status" DEFAULT 'SUBMITTED' NOT NULL,
	"weight" numeric(5, 2) DEFAULT 1 NOT NULL,
	"verified_at" timestamp with time zone,
	"content_hash" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"course" text NOT NULL,
	"week_start" date NOT NULL,
	"classes_held" integer NOT NULL,
	"classes_attended" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faculty_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"rater_user_id" text,
	"kind" text NOT NULL,
	"rating" numeric(3, 2) NOT NULL,
	"status" "verification_status" DEFAULT 'ATTESTED' NOT NULL,
	"rated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrity_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"check" text NOT NULL,
	"subject_id" text NOT NULL,
	"detail" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"resolved_by" text,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internship_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"organisation" text NOT NULL,
	"hours" integer NOT NULL,
	"status" "verification_status" DEFAULT 'SUBMITTED' NOT NULL,
	"confirmed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"test_type" text NOT NULL,
	"items" integer NOT NULL,
	"score" numeric(6, 2) NOT NULL,
	"percentile" numeric(5, 2) NOT NULL,
	"avg_seconds_per_item" numeric(7, 2) NOT NULL,
	"target_seconds_per_item" numeric(7, 2),
	"item_kind" text,
	"source" text NOT NULL,
	"status" "verification_status" NOT NULL,
	"taken_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counseling_card_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"from_column" "counseling_column" NOT NULL,
	"to_column" "counseling_column" NOT NULL,
	"reason" text,
	"actor_user_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counseling_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"intervention_id" uuid,
	"mentor_user_id" text NOT NULL,
	"column" "counseling_column" DEFAULT 'REFERRED' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"next_date" timestamp with time zone,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"policy_version" text NOT NULL,
	"engine_version" text NOT NULL,
	"model_provider" text,
	"model_version" text,
	"prompt_version" text,
	"input_hash" text NOT NULL,
	"track" "track" NOT NULL,
	"track_score" numeric(7, 4) NOT NULL,
	"readiness" integer NOT NULL,
	"gap_ratio" numeric(7, 4) NOT NULL,
	"gap_index" "aeg_level" NOT NULL,
	"aeg_index" "aeg_level" NOT NULL,
	"primary_persona" "persona",
	"trend" "trend" NOT NULL,
	"confidence" "confidence" NOT NULL,
	"result" jsonb NOT NULL,
	"narrative" jsonb,
	"fallback" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"route_key" text NOT NULL,
	"recipient_role" "role" NOT NULL,
	"approver_role" "role" NOT NULL,
	"copy_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "intervention_status" DEFAULT 'PENDING_APPROVAL' NOT NULL,
	"queued" boolean DEFAULT false NOT NULL,
	"proposed_message" text NOT NULL,
	"final_message" text,
	"approver_user_id" text,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"sla_due_at" timestamp with time zone NOT NULL,
	"closure_rule" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"version" text PRIMARY KEY NOT NULL,
	"status" "policy_status" DEFAULT 'DRAFT' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"document" jsonb NOT NULL,
	"created_by" text,
	"approvals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"evaluation_id" uuid,
	"title" text NOT NULL,
	"action" text NOT NULL,
	"target_days" integer NOT NULL,
	"required_evidence_type" text NOT NULL,
	"component_key" text,
	"standard_item" text,
	"opportunity_id" uuid,
	"status" "quest_status" DEFAULT 'PROPOSED' NOT NULL,
	"evidence_artifact_id" uuid,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aspirations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"track" "track",
	"target_outcome" text NOT NULL,
	"target_type" text,
	"target_date" date,
	"readiness" integer DEFAULT 70 NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"change_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"standards_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_assignments" (
	"staff_user_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_assignments_staff_user_id_student_id_role_pk" PRIMARY KEY("staff_user_id","student_id","role")
);
--> statement-breakpoint
CREATE TABLE "staff_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"department_code" text,
	"title" text
);
--> statement-breakpoint
CREATE TABLE "student_identities" (
	"student_id" uuid PRIMARY KEY NOT NULL,
	"roll_number" text NOT NULL,
	"display_name" text NOT NULL,
	CONSTRAINT "student_identities_roll_number_unique" UNIQUE("roll_number")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"pseudonymous_id" text NOT NULL,
	"department_code" text NOT NULL,
	"year" integer NOT NULL,
	"batch" text NOT NULL,
	"declared_track" "track",
	"cgpa" numeric(4, 2),
	"attendance_pct" numeric(5, 2),
	"active_backlogs" integer DEFAULT 0 NOT NULL,
	"date_of_birth" date,
	"is_synthetic" boolean DEFAULT false NOT NULL,
	"last_activity_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "students_pseudonymous_id_unique" UNIQUE("pseudonymous_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_opt_ins" ADD CONSTRAINT "leaderboard_opt_ins_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_requests" ADD CONSTRAINT "rights_requests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_status_events" ADD CONSTRAINT "artifact_status_events_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_status_events" ADD CONSTRAINT "artifact_status_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_weeks" ADD CONSTRAINT "attendance_weeks_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faculty_ratings" ADD CONSTRAINT "faculty_ratings_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faculty_ratings" ADD CONSTRAINT "faculty_ratings_rater_user_id_user_id_fk" FOREIGN KEY ("rater_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_flags" ADD CONSTRAINT "integrity_flags_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_flags" ADD CONSTRAINT "integrity_flags_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internship_records" ADD CONSTRAINT "internship_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internship_records" ADD CONSTRAINT "internship_records_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD CONSTRAINT "mock_attempts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling_card_moves" ADD CONSTRAINT "counseling_card_moves_card_id_counseling_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."counseling_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling_card_moves" ADD CONSTRAINT "counseling_card_moves_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling_cards" ADD CONSTRAINT "counseling_cards_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling_cards" ADD CONSTRAINT "counseling_cards_intervention_id_interventions_id_fk" FOREIGN KEY ("intervention_id") REFERENCES "public"."interventions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling_cards" ADD CONSTRAINT "counseling_cards_mentor_user_id_user_id_fk" FOREIGN KEY ("mentor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interventions" ADD CONSTRAINT "interventions_approver_user_id_user_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aspirations" ADD CONSTRAINT "aspirations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_staff_user_id_user_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_department_code_departments_code_fk" FOREIGN KEY ("department_code") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_identities" ADD CONSTRAINT "student_identities_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_department_code_departments_code_fk" FOREIGN KEY ("department_code") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id","at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_events" USING btree ("actor_user_id","at");--> statement-breakpoint
CREATE INDEX "opportunities_embedding_idx" ON "opportunities" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "remediation_embedding_idx" ON "remediation_library" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "consent_lookup_idx" ON "consent_records" USING btree ("student_id","category","recipient_role","changed_at");--> statement-breakpoint
CREATE INDEX "artifacts_student_idx" ON "artifacts" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "artifacts_hash_idx" ON "artifacts" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "attendance_student_week_idx" ON "attendance_weeks" USING btree ("student_id","week_start");--> statement-breakpoint
CREATE INDEX "mocks_student_idx" ON "mock_attempts" USING btree ("student_id","taken_at");--> statement-breakpoint
CREATE INDEX "evaluations_student_idx" ON "evaluations" USING btree ("student_id","created_at");--> statement-breakpoint
CREATE INDEX "interventions_status_idx" ON "interventions" USING btree ("status","approver_role");--> statement-breakpoint
CREATE INDEX "aspirations_student_idx" ON "aspirations" USING btree ("student_id","is_current");--> statement-breakpoint
CREATE INDEX "students_dept_idx" ON "students" USING btree ("department_code","year");