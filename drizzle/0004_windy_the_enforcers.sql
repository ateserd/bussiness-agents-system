CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"type" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "branch" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_task_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "question" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "answer" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "result" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "tasks_agent_idx" ON "tasks" USING btree ("agent_id");