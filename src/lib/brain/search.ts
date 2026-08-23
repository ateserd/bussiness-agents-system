import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { memories, type Memory } from "@/db/schema";
import type { AgentConfig } from "@/lib/agents/registry";
import { cosine, embed } from "./embed";
import { allowedScopes, filterByScope, scopeOverlapSql } from "./scope";

export type Recalled = Memory & { score: number };

/**
 * Semantic recall over the shared memory, scoped to what the agent may see.
 *
 * Ranking happens in JS rather than through pgvector. PGlite 0.5.x does not
 * bundle the vector extension, and at this corpus size a dot product over a few
 * thousand 256-float rows is sub-millisecond — the query cost is dominated by
 * fetching the rows either way. README documents the swap to a `vector` column
 * plus an HNSW index for when the corpus outgrows this.
 */
export async function recall(options: {
  agent: Pick<AgentConfig, "memory_scopes" | "id">;
  query: string;
  limit?: number;
  /** Drop anything below this similarity. Keeps irrelevant context out of prompts. */
  floor?: number;
  kinds?: Memory["kind"][];
}): Promise<Recalled[]> {
  const { agent, query, limit = 12, floor = 0.05 } = options;
  const granted = allowedScopes(agent);
  const db = await getDb();

  const rows = (await db
    .select()
    .from(memories)
    .where(sql.raw(scopeOverlapSql(granted)))) as Memory[];

  // Belt and braces: the SQL prefilter and the JS rule agree, but the JS rule
  // is the one that decides.
  const visible = filterByScope(granted, rows).filter((row) =>
    options.kinds ? options.kinds.includes(row.kind) : true,
  );

  const queryVector = await embed(query);

  const scored = visible
    .map((row) => ({
      ...row,
      score: row.embedding ? cosine(queryVector, row.embedding) : 0,
    }))
    // Permanent facts and well-used memories earn a small, bounded lift so that
    // established truth outranks a one-off note of equal lexical similarity.
    .map((row) => ({
      ...row,
      score:
        row.score +
        (row.permanent ? 0.08 : 0) +
        Math.min(row.useCount, 20) * 0.002 +
        (row.confidence - 0.5) * 0.04,
    }))
    .filter((row) => row.score > floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length > 0) {
    await markUsed(scored.map((s) => s.id));
  }

  return scored;
}


async function markUsed(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const list = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
  await db.execute(
    sql.raw(
      `update memories set use_count = use_count + 1, last_used_at = now() where id in (${list})`,
    ),
  );
}
