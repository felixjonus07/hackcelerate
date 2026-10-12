-- The counters were text; cast them (nulls become 0) before adding NOT NULL defaults.
ALTER TABLE "ingestion_runs" ALTER COLUMN "rows_total" SET DATA TYPE integer USING COALESCE("rows_total"::integer, 0);--> statement-breakpoint
ALTER TABLE "ingestion_runs" ALTER COLUMN "rows_total" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ALTER COLUMN "rows_total" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ALTER COLUMN "rows_rejected" SET DATA TYPE integer USING COALESCE("rows_rejected"::integer, 0);--> statement-breakpoint
ALTER TABLE "ingestion_runs" ALTER COLUMN "rows_rejected" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ALTER COLUMN "rows_rejected" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD COLUMN "rows_accepted" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN "max_score" numeric(6, 2) DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN "quality_flag" text;--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN "raw_answers" jsonb;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD COLUMN "requires_two_approvals" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD COLUMN "changed_sections" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD COLUMN "supersedes" text;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "credits_held" integer;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "erp_imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "erp_stale" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_unique_week" ON "attendance_weeks" USING btree ("student_id","course","week_start");