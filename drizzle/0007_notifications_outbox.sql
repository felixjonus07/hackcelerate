CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" text,
	"recipient_role" text,
	"student_id" uuid,
	"channel" text DEFAULT 'in_app' NOT NULL,
	"template" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"related_type" text,
	"related_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("recipient_user_id","status");--> statement-breakpoint
CREATE INDEX "notifications_role_idx" ON "notifications" USING btree ("recipient_role","status");