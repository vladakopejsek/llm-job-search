CREATE TYPE "public"."application_stage" AS ENUM('lead', 'applied', 'screening', 'interviewing', 'offer', 'rejected', 'no_response');--> statement-breakpoint
ALTER TYPE "public"."company_status" ADD VALUE 'discovered';--> statement-breakpoint
CREATE TABLE "applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"company" text NOT NULL,
	"stage" "application_stage" NOT NULL,
	"role" text,
	"role_url" text,
	"posting_key" text,
	"tier" text,
	"applied_on" date,
	"last_contact" date,
	"outcome" text,
	"notion_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_notion_url_unique" UNIQUE("notion_url")
);
--> statement-breakpoint
CREATE TABLE "discovered_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"posting_key" text NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"url" text NOT NULL,
	"first_seen" timestamp with time zone,
	"last_seen_in_snapshot" timestamp with time zone NOT NULL,
	CONSTRAINT "discovered_roles_posting_key_unique" UNIQUE("posting_key")
);
--> statement-breakpoint
ALTER TABLE "discovered_roles" ADD CONSTRAINT "discovered_roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_posting_key_idx" ON "applications" USING btree ("posting_key");--> statement-breakpoint
CREATE INDEX "discovered_roles_company_idx" ON "discovered_roles" USING btree ("company_id");