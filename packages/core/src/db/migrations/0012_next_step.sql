ALTER TABLE "applications" ADD COLUMN "next_step_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "next_step_kind" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "next_step_with" text;