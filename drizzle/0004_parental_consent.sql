ALTER TABLE "students" ADD COLUMN "parental_consent_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "parental_consent_at" timestamp with time zone;