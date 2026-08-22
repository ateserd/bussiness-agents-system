ALTER TABLE "tasks" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "place_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "review_count" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "rating" numeric(2, 1);--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "contacted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "leads_retention_idx" ON "leads" USING btree ("contacted_at","created_at");