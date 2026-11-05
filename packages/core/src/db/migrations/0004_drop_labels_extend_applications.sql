ALTER TYPE "public"."application_stage" ADD VALUE 'skipped';--> statement-breakpoint
ALTER TABLE "labels" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "labels" CASCADE;--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "notion_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "company_id" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "posting_id" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "first_response_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "followed_up_on" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "snoozed_until" date;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "skip_reason" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_posting_id_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_posting_idx" ON "applications" USING btree ("posting_id");--> statement-breakpoint
DROP TYPE "public"."eligibility";--> statement-breakpoint
DROP TYPE "public"."interest";