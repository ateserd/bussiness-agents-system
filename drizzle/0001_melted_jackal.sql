CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"branch" text,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"amount_usd" numeric(12, 2) NOT NULL,
	"recurring" boolean DEFAULT false NOT NULL,
	"spent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "expenses_branch_spent_idx" ON "expenses" USING btree ("branch","spent_at");