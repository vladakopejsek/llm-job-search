CREATE TYPE "public"."prior_verdict" AS ENUM('lead', 'follow_up', 'rejected', 'needs_check');--> statement-breakpoint
CREATE TYPE "public"."screen_status" AS ENUM('pass', 'reject');--> statement-breakpoint
CREATE TABLE "prior_verdicts" (
	"id" serial PRIMARY KEY NOT NULL,
	"posting_key" text NOT NULL,
	"role_url" text NOT NULL,
	"company" text,
	"title" text NOT NULL,
	"verdict" "prior_verdict" NOT NULL,
	"reason" text,
	"source" text,
	"first_seen" date,
	"notion_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prior_verdicts_notion_url_unique" UNIQUE("notion_url")
);
--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "screen_status" "screen_status";--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "screen_rule" text;--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "screen_reason" text;--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "screened_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "prior_verdicts_posting_key_idx" ON "prior_verdicts" USING btree ("posting_key");