CREATE TABLE "notice_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"version" text NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"opted_in" boolean DEFAULT false NOT NULL,
	"destination" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_channel_pk" PRIMARY KEY("user_id","channel")
);
--> statement-breakpoint
CREATE TABLE "wellbeing_nudges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"detected_on" date NOT NULL,
	"explanation" text NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rights_requests" ADD COLUMN "routed_to_role" text;--> statement-breakpoint
ALTER TABLE "rights_requests" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "rights_requests" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rights_requests" ADD COLUMN "resolved_by" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "onboarding_step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "graduated_on" date;--> statement-breakpoint
ALTER TABLE "notice_acknowledgements" ADD CONSTRAINT "notice_acknowledgements_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wellbeing_nudges" ADD CONSTRAINT "wellbeing_nudges_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notice_ack_unique" ON "notice_acknowledgements" USING btree ("student_id","version");--> statement-breakpoint
CREATE INDEX "wellbeing_student_idx" ON "wellbeing_nudges" USING btree ("student_id","created_at");