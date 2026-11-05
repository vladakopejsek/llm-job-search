CREATE TYPE "public"."eligibility" AS ENUM('eligible', 'not_eligible', 'unclear');--> statement-breakpoint
CREATE TYPE "public"."interest" AS ENUM('apply', 'maybe', 'skip');--> statement-breakpoint
CREATE TABLE "labels" (
	"id" serial PRIMARY KEY NOT NULL,
	"posting_id" integer NOT NULL,
	"snapshot_id" integer NOT NULL,
	"eligibility" "eligibility" NOT NULL,
	"interest" "interest" NOT NULL,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"sample" text NOT NULL,
	"labeled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "labels_posting_id_unique" UNIQUE("posting_id")
);
--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_posting_id_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_snapshot_id_posting_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."posting_snapshots"("id") ON DELETE no action ON UPDATE no action;