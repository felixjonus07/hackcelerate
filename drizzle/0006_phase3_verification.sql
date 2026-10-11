ALTER TABLE "audit_events" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "claim_key" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "text_hash" text;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "next_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "attested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integrity_flags" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN "sampled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN "sample_outcome" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "github_login" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "github_linked_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "artifacts_claim_idx" ON "artifacts" USING btree ("claim_key");--> statement-breakpoint
CREATE INDEX "artifacts_text_hash_idx" ON "artifacts" USING btree ("text_hash");--> statement-breakpoint
CREATE INDEX "artifacts_next_check_idx" ON "artifacts" USING btree ("next_check_at");--> statement-breakpoint
ALTER TABLE "integrity_flags" ADD CONSTRAINT "integrity_flags_dedupe_key_unique" UNIQUE("dedupe_key");