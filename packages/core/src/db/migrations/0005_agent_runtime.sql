CREATE TYPE "public"."evidence" AS ENUM('verified', 'partial', 'none');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('lead', 'rejected', 'needs_check');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"git_sha" text,
	"stats" jsonb
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"posting_id" integer NOT NULL,
	"snapshot_id" integer NOT NULL,
	"run_id" integer,
	"facts" jsonb NOT NULL,
	"verdict" "verdict" NOT NULL,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"fit_score" integer,
	"evidence" "evidence" NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"purpose" text DEFAULT 'queue' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcome_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"proposed_stage" "application_stage" NOT NULL,
	"evidence" jsonb NOT NULL,
	"message_id" text NOT NULL,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"run_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "outcome_proposals_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "prep_packs" (
	"id" serial PRIMARY KEY NOT NULL,
	"posting_id" integer NOT NULL,
	"evaluation_id" integer NOT NULL,
	"run_id" integer,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_posting_id_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_snapshot_id_posting_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."posting_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_proposals" ADD CONSTRAINT "outcome_proposals_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_proposals" ADD CONSTRAINT "outcome_proposals_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_packs" ADD CONSTRAINT "prep_packs_posting_id_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_packs" ADD CONSTRAINT "prep_packs_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_packs" ADD CONSTRAINT "prep_packs_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evaluations_posting_snapshot_idx" ON "evaluations" USING btree ("posting_id","snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prep_packs_evaluation_idx" ON "prep_packs" USING btree ("evaluation_id");