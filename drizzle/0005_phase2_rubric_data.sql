CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"items" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"title" text NOT NULL,
	"due_on" date NOT NULL,
	"completed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mock_attempts" ADD COLUMN "difficulty" text;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_student_at_idx" ON "activity_events" USING btree ("student_id","at");--> statement-breakpoint
CREATE INDEX "milestones_student_idx" ON "milestones" USING btree ("student_id","scope");