CREATE TABLE "agent_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer,
	"kind" text NOT NULL,
	"posting_id" integer,
	"attempt" integer NOT NULL,
	"status" text NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ui_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"posting_id" integer NOT NULL,
	"type" text NOT NULL,
	"arm" text,
	"tab_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_attempts" ADD CONSTRAINT "agent_attempts_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ui_events" ADD CONSTRAINT "ui_events_posting_id_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_attempts_run_idx" ON "agent_attempts" USING btree ("run_id","kind");--> statement-breakpoint
CREATE INDEX "ui_events_posting_idx" ON "ui_events" USING btree ("posting_id","at");