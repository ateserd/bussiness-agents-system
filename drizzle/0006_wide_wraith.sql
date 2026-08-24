CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text DEFAULT 'telegram' NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "conversations_created_idx" ON "conversations" USING btree ("channel","created_at");