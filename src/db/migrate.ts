import fs from "node:fs";
import path from "node:path";
import { closeDb, DATA_DIR, driverName, getConnection, isRemote } from "./client";

/**
 * Applies ./drizzle/*.sql in filename order.
 *
 * We drive the SQL ourselves rather than using `drizzle-kit push` so that one
 * code path covers PGlite and remote Postgres identically, and so the SQL that
 * ran locally is byte-for-byte the SQL that runs against Supabase.
 *
 *   npm run db:generate   # author SQL from schema.ts
 *   npm run db:push       # apply it here
 *   npm run db:push -- --reset   # drop the local database first
 */

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

async function main() {
  const reset = process.argv.includes("--reset");

  if (reset) {
    if (isRemote()) {
      console.error("Refusing to --reset a remote database. Drop it yourself if you mean it.");
      process.exit(1);
    }
    if (fs.existsSync(DATA_DIR)) {
      fs.rmSync(DATA_DIR, { recursive: true, force: true });
      console.log(`· dropped ${path.relative(process.cwd(), DATA_DIR)}`);
    }
  }

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`No migrations found at ./drizzle — run "npm run db:generate" first.`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.error(`./drizzle has no .sql files — run "npm run db:generate" first.`);
    process.exit(1);
  }

  const { raw, query } = await getConnection();

  await raw(`
    create table if not exists __migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const rows = await query<{ name: string }>(`select name from __migrations`);
  const applied = new Set(rows.map((r) => r.name));

  console.log(`· driver: ${driverName()}`);

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    // drizzle-kit separates statements with this marker.
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await raw(statement);
    }
    await raw(`insert into __migrations (name) values ('${file}')`);
    console.log(`· applied ${file} (${statements.length} statements)`);
    ran++;
  }

  console.log(ran === 0 ? "· already up to date" : `· ${ran} migration(s) applied`);
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
