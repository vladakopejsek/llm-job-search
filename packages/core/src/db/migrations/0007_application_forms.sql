ALTER TABLE "postings" ADD COLUMN "application_form" jsonb;--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "application_form_fetched_at" timestamp with time zone;