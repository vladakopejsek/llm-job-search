CREATE TYPE "public"."ats" AS ENUM('ashby', 'greenhouse', 'lever', 'workable', 'recruitee', 'teamtailor', 'personio', 'smartrecruiters', 'other', 'none');--> statement-breakpoint
CREATE TYPE "public"."company_status" AS ENUM('active', 'no_feed', 'paused');--> statement-breakpoint
CREATE TYPE "public"."fetch_status" AS ENUM('ok', 'error', 'unsupported');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('A', 'B', 'C');--> statement-breakpoint
CREATE TABLE "collect_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"ats" "ats" NOT NULL,
	"board_token" text,
	"board_host" text,
	"feed_url" text,
	"board_url" text,
	"priority" "priority",
	"status" "company_status" NOT NULL,
	"notes" text,
	"notion_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "company_fetches" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"status" "fetch_status" NOT NULL,
	"http_status" integer,
	"error" text,
	"postings_total" integer,
	"postings_kept" integer,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posting_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"posting_id" integer NOT NULL,
	"content_hash" text NOT NULL,
	"description_text" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postings" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"location_raw" text,
	"workplace_raw" text,
	"department" text,
	"description_text" text NOT NULL,
	"compensation_raw" jsonb,
	"raw" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"posted_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "company_fetches" ADD CONSTRAINT "company_fetches_run_id_collect_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."collect_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_fetches" ADD CONSTRAINT "company_fetches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_snapshots" ADD CONSTRAINT "posting_snapshots_posting_id_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "posting_snapshots_posting_hash_idx" ON "posting_snapshots" USING btree ("posting_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "postings_company_external_idx" ON "postings" USING btree ("company_id","external_id");--> statement-breakpoint
CREATE INDEX "postings_open_idx" ON "postings" USING btree ("company_id") WHERE "postings"."closed_at" is null;