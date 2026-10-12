CREATE TABLE "audit_events_archive" (
	"id" uuid PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"purpose" text NOT NULL,
	"reason" text,
	"fields_accessed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_version" text NOT NULL,
	"source_ip" text,
	"result" text NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cohort_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" text NOT NULL,
	"department" text NOT NULL,
	"track" text NOT NULL,
	"aeg_index" text NOT NULL,
	"students" integer NOT NULL,
	"mean_score" numeric(7, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demographic_profiles" (
	"student_id" uuid PRIMARY KEY NOT NULL,
	"medium_of_instruction" text,
	"first_generation" boolean,
	"home_region" text,
	"gender" text,
	"device_access" text,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parental_consents" (
	"student_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"method" text,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demographic_profiles" ADD CONSTRAINT "demographic_profiles_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parental_consents" ADD CONSTRAINT "parental_consents_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parental_consents" ADD CONSTRAINT "parental_consents_verified_by_user_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;