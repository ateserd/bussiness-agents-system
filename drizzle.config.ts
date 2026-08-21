import type { Config } from "drizzle-kit";

/**
 * Schema is authored once, in the Postgres dialect.
 *
 * `drizzle-kit generate` emits plain SQL into ./drizzle, which `npm run db:push`
 * then applies through whichever driver is active (PGlite locally, postgres-js
 * when DATABASE_URL is set). Nothing here is PGlite-specific, so pointing the
 * app at Supabase or Neon later replays the exact same migrations.
 */
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
} satisfies Config;
