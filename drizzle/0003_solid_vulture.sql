ALTER TABLE "activity" DROP CONSTRAINT "activity_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "activity" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;