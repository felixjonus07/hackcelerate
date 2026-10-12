ALTER TABLE "counseling_card_moves" ALTER COLUMN "actor_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "counseling_card_moves" ADD COLUMN "actor_kind" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "interventions" ADD COLUMN "dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "interventions" ADD COLUMN "dispatch_blocked_reason" text;--> statement-breakpoint
ALTER TABLE "interventions" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "interventions" ADD COLUMN "escalated_to" text;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "expired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "deferred_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quests" ADD COLUMN "status_note" text;