CREATE TABLE "sampling_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" text NOT NULL,
	"student_id" uuid NOT NULL,
	"term" text NOT NULL,
	"selected" integer NOT NULL,
	"selection_hash" text NOT NULL,
	"verification_status" text DEFAULT 'PENDING',
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_recheck" integer DEFAULT 0 NOT NULL,
	"recheck_failures_before" integer DEFAULT 0 NOT NULL,
	"retryable" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "integrity_flags" ADD COLUMN "related_student_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "integrity_flags" ADD COLUMN "rule_params" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "integrity_flags" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sampling_decisions" ADD CONSTRAINT "sampling_decisions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verification_attempts_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sampling_term_idx" ON "sampling_decisions" USING btree ("term","selected");--> statement-breakpoint
CREATE INDEX "sampling_candidate_idx" ON "sampling_decisions" USING btree ("candidate_id","term");--> statement-breakpoint
CREATE INDEX "verification_attempts_artifact_idx" ON "verification_attempts" USING btree ("artifact_id","started_at");--> statement-breakpoint
CREATE INDEX "integrity_flags_student_idx" ON "integrity_flags" USING btree ("student_id","status");