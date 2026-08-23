CREATE TABLE "outreach_days" (
	"day" text PRIMARY KEY NOT NULL,
	"mail_count" integer,
	"call_count" integer,
	"skip" boolean DEFAULT false NOT NULL,
	"branch" text,
	"focus" text,
	"said_by" text DEFAULT 'owner' NOT NULL,
	"said_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_text" text
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "rejection_note" text;--> statement-breakpoint
CREATE INDEX "leads_pool_idx" ON "leads" USING btree ("rejected_at","fit_score");