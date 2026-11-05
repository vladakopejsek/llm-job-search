-- Trigram matching for partial company-name search (companies_name_trgm_idx below).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."application_event_type" AS ENUM('stage_changed', 'followed_up', 'note', 'email_reply', 'answers_saved', 'snoozed');--> statement-breakpoint
CREATE TYPE "public"."reeval_status" AS ENUM('pending', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "application_answers" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"position" integer NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"origin" text NOT NULL,
	"drafted_answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', question), 'B') || setweight(to_tsvector('english', answer), 'A')) STORED NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"type" "application_event_type" NOT NULL,
	"from_stage" "application_stage",
	"to_stage" "application_stage",
	"occurred_on" date NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"proposal_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"posting_id" integer,
	"snapshot_id" integer,
	"prep_pack_id" integer,
	"cover_letter" text,
	"drafted_cover_letter" text,
	"salary_stated" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(cover_letter, '') || ' ' || coalesce(salary_stated, ''))) STORED NOT NULL,
	CONSTRAINT "application_submissions_application_id_unique" UNIQUE("application_id")
);
--> statement-breakpoint
CREATE TABLE "reevaluation_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"posting_id" integer NOT NULL,
	"snapshot_id" integer NOT NULL,
	"note" text,
	"prior_evaluation_id" integer,
	"prior_verdict" "verdict",
	"prior_reasons" text[],
	"prior_fit_score" integer,
	"prior_facts" jsonb,
	"prior_screen_status" "screen_status",
	"prior_screen_rule" text,
	"status" "reeval_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_evaluation_id" integer,
	"resolved_run_id" integer,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "origin" text DEFAULT 'queue' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "related_application_id" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "promoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(department, '') || ' ' || coalesce(location_raw, '')), 'B') || setweight(to_tsvector('english', left(description_text, 200000)), 'D')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_proposal_id_outcome_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."outcome_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_submissions" ADD CONSTRAINT "application_submissions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_submissions" ADD CONSTRAINT "application_submissions_posting_id_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_submissions" ADD CONSTRAINT "application_submissions_snapshot_id_posting_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."posting_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_submissions" ADD CONSTRAINT "application_submissions_prep_pack_id_prep_packs_id_fk" FOREIGN KEY ("prep_pack_id") REFERENCES "public"."prep_packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reevaluation_requests" ADD CONSTRAINT "reevaluation_requests_posting_id_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reevaluation_requests" ADD CONSTRAINT "reevaluation_requests_snapshot_id_posting_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."posting_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reevaluation_requests" ADD CONSTRAINT "reevaluation_requests_prior_evaluation_id_evaluations_id_fk" FOREIGN KEY ("prior_evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reevaluation_requests" ADD CONSTRAINT "reevaluation_requests_resolved_evaluation_id_evaluations_id_fk" FOREIGN KEY ("resolved_evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reevaluation_requests" ADD CONSTRAINT "reevaluation_requests_resolved_run_id_agent_runs_id_fk" FOREIGN KEY ("resolved_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_answers_app_pos_idx" ON "application_answers" USING btree ("application_id","position");--> statement-breakpoint
CREATE INDEX "application_answers_search_idx" ON "application_answers" USING gin ("search");--> statement-breakpoint
CREATE INDEX "application_events_app_idx" ON "application_events" USING btree ("application_id","occurred_on");--> statement-breakpoint
CREATE INDEX "application_events_type_idx" ON "application_events" USING btree ("type","occurred_on");--> statement-breakpoint
CREATE INDEX "application_submissions_search_idx" ON "application_submissions" USING gin ("search");--> statement-breakpoint
CREATE UNIQUE INDEX "reevaluation_requests_pending_idx" ON "reevaluation_requests" USING btree ("posting_id") WHERE "reevaluation_requests"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_related_application_id_applications_id_fk" FOREIGN KEY ("related_application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_stage_idx" ON "applications" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "companies_name_trgm_idx" ON "companies" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "company_fetches_company_created_idx" ON "company_fetches" USING btree ("company_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "evaluations_posting_created_idx" ON "evaluations" USING btree ("posting_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "postings_search_idx" ON "postings" USING gin ("search");--> statement-breakpoint
CREATE INDEX "postings_first_seen_idx" ON "postings" USING btree ("first_seen_at");--> statement-breakpoint
-- Hand-written data fixes: mark rows imported from Notion, and record where each company came from.
UPDATE "applications" SET "origin" = 'import' WHERE "notion_url" IS NOT NULL;--> statement-breakpoint
UPDATE "companies" c SET "source" = CASE WHEN EXISTS (SELECT 1 FROM "discovered_roles" d WHERE d."company_id" = c."id") OR c."status" = 'discovered' THEN 'discovery' ELSE 'import' END;
