import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { memories, memoryLinks, type Memory, type MemoryKind } from "@/db/schema";
import { cosine, embedSync } from "./embed";
import { assertWritableScopes, scopeOverlapSql } from "./scope";

/**
 * The only way a memory enters the Brain (§5 rules).
 *
 *   - atomic statements only; the caller summarises, this never stores a transcript
 *   - near-duplicates raise confidence and use count instead of inserting again
 *   - contradictions keep both rows, mark the newer as superseding, and link them
 *     so the Brain Keeper can see the conflict
 */

/** Above this cosine, two statements are the same memory said twice. */
const DUPLICATE_THRESHOLD = 0.93;
/** Similar enough to be about the same thing, different enough to possibly conflict. */
const RELATED_THRESHOLD = 0.72;

export type WriteMemoryInput = {
  kind: MemoryKind;
  scopes: string[];
  content: string;
  sourceAgentId?: string | null;
  sourceActivityId?: string | null;
  sourceUrl?: string | null;
  confidence?: number;
  permanent?: boolean;
  /** Set when the caller already knows this replaces a specific earlier memory. */
  supersedes?: string | null;
};

export type WriteResult =
  | { action: "inserted"; memory: Memory }
  | { action: "merged"; memory: Memory; into: string }
  | { action: "superseded"; memory: Memory; replaced: string };

export async function writeMemory(input: WriteMemoryInput): Promise<WriteResult> {
  const db = await getDb();
  const content = input.content.trim();

  if (!content) throw new Error("writeMemory: content is empty");
  if (content.length > 600) {
    throw new Error(
      `writeMemory: ${content.length} chars is a transcript, not a memory. Summarise into one statement and link the artifact.`,
    );
  }
  assertWritableScopes(input.scopes);

  const vector = embedSync(content);

  // Only compare against memories in overlapping scopes: the same sentence can
  // legitimately be true for one branch and not the other.
  const neighbours = (await db
    .select()
    .from(memories)
    .where(sql.raw(scopeOverlapSql(input.scopes)))) as Memory[];

  let bestDuplicate: { row: Memory; score: number } | null = null;
  const related: { row: Memory; score: number }[] = [];

  for (const row of neighbours) {
    if (!row.embedding) continue;
    const score = cosine(vector, row.embedding);
    if (score >= DUPLICATE_THRESHOLD) {
      if (!bestDuplicate || score > bestDuplicate.score) bestDuplicate = { row, score };
    } else if (score >= RELATED_THRESHOLD) {
      related.push({ row, score });
    }
  }

  // Near-duplicate: reinforce rather than insert.
  if (bestDuplicate) {
    const existing = bestDuplicate.row;
    const confidence = Math.min(1, Math.max(existing.confidence, input.confidence ?? 0.6) + 0.05);
    const [updated] = await db
      .update(memories)
      .set({
        confidence,
        useCount: existing.useCount + 1,
        lastUsedAt: new Date(),
        permanent: existing.permanent || Boolean(input.permanent),
      })
      .where(eq(memories.id, existing.id))
      .returning();
    return { action: "merged", memory: updated, into: existing.id };
  }

  const id = randomUUID();
  const [inserted] = await db
    .insert(memories)
    .values({
      id,
      kind: input.kind,
      scopes: input.scopes,
      content,
      sourceAgentId: input.sourceAgentId ?? null,
      sourceActivityId: input.sourceActivityId ?? null,
      sourceUrl: input.sourceUrl ?? null,
      confidence: input.confidence ?? 0.6,
      permanent: input.permanent ?? false,
      embedding: vector,
      supersedes: input.supersedes ?? null,
      createdAt: new Date(),
    })
    .returning();

  // Link to what it is about, so the constellation has real edges and the Brain
  // Keeper has somewhere to look for conflicts.
  for (const { row } of related.slice(0, 4)) {
    await db
      .insert(memoryLinks)
      .values({
        id: randomUUID(),
        fromId: id,
        toId: row.id,
        kind: input.supersedes === row.id ? "supersedes" : "relates",
      })
      .onConflictDoNothing();
  }

  if (input.supersedes) {
    return { action: "superseded", memory: inserted, replaced: input.supersedes };
  }
  return { action: "inserted", memory: inserted };
}

/**
 * Records that `newer` contradicts `older` without deleting either — §5. The
 * Brain Keeper resolves it; until then both are visible and the conflict is
 * queryable.
 */
export async function recordContradiction(newerId: string, olderId: string): Promise<void> {
  const db = await getDb();
  await db.update(memories).set({ supersedes: olderId }).where(eq(memories.id, newerId));
  await db
    .insert(memoryLinks)
    .values({ id: randomUUID(), fromId: newerId, toId: olderId, kind: "contradicts" })
    .onConflictDoNothing();
}
