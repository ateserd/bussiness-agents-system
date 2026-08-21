CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"branch" text NOT NULL,
	"department" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"reason" text,
	"input" jsonb,
	"output" jsonb,
	"unsure_about" text,
	"outcome" text NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"task_id" text,
	"error" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"branch" text NOT NULL,
	"department" text NOT NULL,
	"tier" text NOT NULL,
	"reports_to" text,
	"accent" text NOT NULL,
	"avatar" text,
	"status" text DEFAULT 'idle' NOT NULL,
	"mission" text NOT NULL,
	"prompt_file" text NOT NULL,
	"model" text NOT NULL,
	"effort" text DEFAULT 'high' NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"memory_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approval_required_for" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"escalate_when" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"schedule" text,
	"autonomy" text DEFAULT 'propose' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"blocker" text,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"branch" text NOT NULL,
	"gate" text NOT NULL,
	"title" text NOT NULL,
	"draft" text NOT NULL,
	"context" jsonb,
	"estimated_cost_usd" numeric(10, 2),
	"state" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"rejection_reason" text,
	"activity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"branch" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"health" text DEFAULT 'active' NOT NULL,
	"mrr_usd" numeric(12, 2) DEFAULT '0' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_contact_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" text PRIMARY KEY NOT NULL,
	"branch" text NOT NULL,
	"lead_id" text,
	"title" text NOT NULL,
	"stage" text DEFAULT 'new' NOT NULL,
	"value_usd" numeric(12, 2) DEFAULT '0' NOT NULL,
	"mrr_usd" numeric(12, 2) DEFAULT '0' NOT NULL,
	"owner_agent_id" text,
	"stalled" boolean DEFAULT false NOT NULL,
	"last_moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"branch" text NOT NULL,
	"client_id" text,
	"number" text NOT NULL,
	"amount_usd" numeric(12, 2) NOT NULL,
	"state" text DEFAULT 'sent' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kpi_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"value" real NOT NULL,
	"target" real,
	"window" text DEFAULT 'weekly' NOT NULL,
	"day" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"branch" text NOT NULL,
	"company" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"website" text,
	"city" text,
	"sector" text,
	"fit_score" integer DEFAULT 0 NOT NULL,
	"thesis" text,
	"source" text,
	"source_agent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"scopes" text[] NOT NULL,
	"content" text NOT NULL,
	"source_agent_id" text,
	"source_activity_id" text,
	"source_url" text,
	"confidence" real DEFAULT 0.6 NOT NULL,
	"permanent" boolean DEFAULT false NOT NULL,
	"embedding" real[],
	"use_count" integer DEFAULT 0 NOT NULL,
	"supersedes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "memory_links" (
	"id" text PRIMARY KEY NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"kind" text DEFAULT 'relates' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"branch" text NOT NULL,
	"client_id" text,
	"name" text NOT NULL,
	"stage" text DEFAULT 'brief' NOT NULL,
	"healthy" boolean DEFAULT true NOT NULL,
	"at_risk" boolean DEFAULT false NOT NULL,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload" jsonb,
	"run_key" text,
	"scheduled_for" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_source_agent_id_agents_id_fk" FOREIGN KEY ("source_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_links" ADD CONSTRAINT "memory_links_from_id_memories_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_links" ADD CONSTRAINT "memory_links_to_id_memories_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_started_idx" ON "activity" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "activity_agent_idx" ON "activity" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "activity_outcome_idx" ON "activity" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "agents_branch_idx" ON "agents" USING btree ("branch");--> statement-breakpoint
CREATE INDEX "agents_reports_to_idx" ON "agents" USING btree ("reports_to");--> statement-breakpoint
CREATE INDEX "approvals_state_idx" ON "approvals" USING btree ("state");--> statement-breakpoint
CREATE INDEX "clients_branch_idx" ON "clients" USING btree ("branch");--> statement-breakpoint
CREATE INDEX "deals_branch_stage_idx" ON "deals" USING btree ("branch","stage");--> statement-breakpoint
CREATE INDEX "invoices_branch_state_idx" ON "invoices" USING btree ("branch","state");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_agent_name_day_idx" ON "kpi_snapshots" USING btree ("agent_id","name","day");--> statement-breakpoint
CREATE INDEX "kpi_agent_idx" ON "kpi_snapshots" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "leads_branch_idx" ON "leads" USING btree ("branch");--> statement-breakpoint
CREATE INDEX "memories_kind_idx" ON "memories" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "memories_created_idx" ON "memories" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_link_pair_idx" ON "memory_links" USING btree ("from_id","to_id");--> statement-breakpoint
CREATE INDEX "projects_branch_idx" ON "projects" USING btree ("branch");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_run_key_idx" ON "tasks" USING btree ("run_key");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");