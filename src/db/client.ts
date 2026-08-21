import path from "node:path";
import * as schema from "./schema";

/**
 * One place decides which Postgres you are talking to.
 *
 *   DATABASE_URL unset -> PGlite, a WASM Postgres running in-process against
 *                          ./data/mission-control. No server, no Docker, no
 *                          network. This is the default so `npm run dev` works
 *                          on a clean checkout.
 *   DATABASE_URL set   -> postgres-js against Supabase / Neon / anything else.
 *
 * Both are real Postgres and share one schema and one set of migrations, so
 * moving between them is a connection string, not a rewrite.
 */

export type Database = Awaited<ReturnType<typeof createDb>>["db"];

export const DATA_DIR = path.join(process.cwd(), "data", "mission-control");

export function isRemote(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function driverName(): string {
  return isRemote() ? "postgres-js" : "pglite";
}

async function createDb() {
  const url = process.env.DATABASE_URL;

  if (url) {
    const [{ drizzle }, postgres] = await Promise.all([
      import("drizzle-orm/postgres-js"),
      import("postgres").then((m) => m.default),
    ]);
    const sql = postgres(url, { max: 4, prepare: false });
    return {
      db: drizzle(sql, { schema }),
      close: async () => {
        await sql.end({ timeout: 5 });
      },
      raw: async (statement: string) => {
        await sql.unsafe(statement);
      },
      query: async <T>(statement: string): Promise<T[]> => {
        return (await sql.unsafe(statement)) as unknown as T[];
      },
    };
  }

  const [{ drizzle }, { PGlite }, fs] = await Promise.all([
    import("drizzle-orm/pglite"),
    import("@electric-sql/pglite"),
    import("node:fs"),
  ]);
  // PGlite creates its own data directory but not the parent of it.
  fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });
  const pg = new PGlite(DATA_DIR);
  await pg.waitReady;
  return {
    db: drizzle(pg, { schema }),
    close: async () => {
      await pg.close();
    },
    raw: async (statement: string) => {
      await pg.exec(statement);
    },
    query: async <T>(statement: string): Promise<T[]> => {
      const result = await pg.query<T>(statement);
      return result.rows;
    },
  };
}

/**
 * Next dev reloads modules on every edit; without this the process would open a
 * new PGlite instance per reload and the second one would fail to take the data
 * directory lock.
 */
const globalForDb = globalThis as unknown as {
  __missionControlDb?: Promise<Awaited<ReturnType<typeof createDb>>>;
};

export function getConnection() {
  globalForDb.__missionControlDb ??= createDb();
  return globalForDb.__missionControlDb;
}

/** The handle nearly everything should use. */
export async function getDb(): Promise<Database> {
  return (await getConnection()).db;
}

/** Only scripts should call this — the Next server keeps its connection open. */
export async function closeDb(): Promise<void> {
  const conn = globalForDb.__missionControlDb;
  if (!conn) return;
  await (await conn).close();
  globalForDb.__missionControlDb = undefined;
}
