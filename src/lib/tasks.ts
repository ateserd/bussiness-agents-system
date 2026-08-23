import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tasks, type Branch, type Task } from "@/db/schema";

/**
 * The work queue.
 *
 * The shape this exists to support: an agent that is unsure asks the owner,
 * *its* task parks, and everything else keeps running. That is why parking is
 * a task state rather than a flag on the agent or a blocked promise — one
 * question must not stall the other three agents, and the owner answers on his
 * own schedule, possibly hours later and possibly after a restart.
 *
 * Claiming is a conditional UPDATE rather than a select-then-write, so two
 * runners racing for the same row resolve in the database instead of in a lock
 * we would have to maintain. The loser simply gets nothing back and moves on.
 */

export type TaskPayload = {
  /** What the worker is actually asked to do, in Turkish. */
  instruction?: string;
  /** Where the task came from: "manager" | "schedule" | "system". */
  source?: string;
  [key: string]: unknown;
};

/** Short handle the owner sees on Telegram. Full uuids are unusable in chat. */
export function shortId(id: string): string {
  return id.slice(0, 6);
}

export async function createTask(input: {
  agentId: string | null;
  title: string;
  instruction: string;
  branch?: Branch | null;
  parentTaskId?: string | null;
  source?: string;
  runKey?: string | null;
}): Promise<Task> {
  const db = await getDb();
  const payload: TaskPayload = { instruction: input.instruction, source: input.source ?? "manager" };
  const [row] = await db
    .insert(tasks)
    .values({
      id: randomUUID(),
      agentId: input.agentId,
      title: input.title,
      status: "queued",
      payload,
      branch: input.branch ?? null,
      parentTaskId: input.parentTaskId ?? null,
      runKey: input.runKey ?? null,
      createdAt: new Date(),
    })
    .returning();
  return row;
}

/**
 * Take up to `limit` queued tasks, oldest first.
 *
 * Each row is claimed with `WHERE status = 'queued'`, so the transition is the
 * lock. A row another runner already took returns nothing and is skipped.
 */
export async function claimQueued(limit: number): Promise<Task[]> {
  const db = await getDb();
  const candidates = await db
    .select()
    .from(tasks)
    .where(eq(tasks.status, "queued"))
    .orderBy(asc(tasks.createdAt))
    .limit(limit);

  const claimed: Task[] = [];
  for (const c of candidates) {
    const [row] = await db
      .update(tasks)
      .set({ status: "running", startedAt: new Date(), attempts: sql`${tasks.attempts} + 1` })
      .where(and(eq(tasks.id, c.id), eq(tasks.status, "queued")))
      .returning();
    if (row) claimed.push(row);
  }
  return claimed;
}

export async function finishTask(id: string, result: string): Promise<void> {
  const db = await getDb();
  await db
    .update(tasks)
    .set({ status: "done", result: result.slice(0, 500), finishedAt: new Date() })
    .where(eq(tasks.id, id));
}

export async function failTask(id: string, error: string): Promise<void> {
  const db = await getDb();
  await db
    .update(tasks)
    .set({ status: "failed", lastError: error.slice(0, 500), finishedAt: new Date() })
    .where(eq(tasks.id, id));
}

/**
 * Park a task on a question for the owner. The run that called this is over —
 * it resumes as a fresh run once answered, with the answer in the payload.
 */
export async function parkTask(id: string, question: string): Promise<void> {
  const db = await getDb();
  await db
    .update(tasks)
    .set({ status: "waiting_owner", question: question.slice(0, 500), askedAt: new Date() })
    .where(eq(tasks.id, id));
}

/**
 * Feed the owner's reply back in and re-queue.
 *
 * The answer goes into the payload as well as its own column so the resumed
 * run sees it as part of its instructions without the runner having to special
 * case a resumed task.
 */
export async function answerTask(id: string, answer: string): Promise<Task | null> {
  const db = await getDb();
  const [existing] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!existing || existing.status !== "waiting_owner") return null;

  const payload: TaskPayload = { ...(existing.payload ?? {}), ownerAnswer: answer };
  const [row] = await db
    .update(tasks)
    .set({ status: "queued", answer, answeredAt: new Date(), payload })
    .where(and(eq(tasks.id, id), eq(tasks.status, "waiting_owner")))
    .returning();
  return row ?? null;
}

/** Everything currently parked on the owner, oldest question first. */
export async function openQuestions(): Promise<Task[]> {
  const db = await getDb();
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.status, "waiting_owner"))
    .orderBy(asc(tasks.askedAt));
}

export async function runningTasks(): Promise<Task[]> {
  const db = await getDb();
  return db.select().from(tasks).where(eq(tasks.status, "running")).orderBy(desc(tasks.startedAt));
}

/**
 * Rows still marked `running` long after any real run could still be going.
 *
 * `runUnit` catches a *thrown* error and settles the row. It cannot catch the
 * process disappearing — a systemd restart, an OOM kill, a reclaimed container
 * — and that leaves the row `running` forever. Nothing else ever looks at it
 * again, so the system map keeps reporting work that stopped days ago, and the
 * dashboard shows an agent that is not there.
 *
 * The cutoff has to be well past the run timeout, or a slow-but-live run gets
 * declared dead underneath itself.
 */
export async function staleRunning(now: Date, olderThanMs: number): Promise<Task[]> {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - olderThanMs);
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "running"), lt(tasks.startedAt, cutoff)));
}

export async function recentTasks(limit = 20): Promise<Task[]> {
  const db = await getDb();
  return db
    .select()
    .from(tasks)
    .where(inArray(tasks.status, ["done", "failed", "blocked"]))
    .orderBy(desc(tasks.finishedAt))
    .limit(limit);
}

/**
 * Find the parked task an untyped reply belongs to.
 *
 * The owner will not quote a task id, so this resolves by count rather than by
 * guessing: exactly one open question means the reply is unambiguous. With
 * several open, it returns them all and the caller must ask which — picking the
 * most recent would eventually attach an answer to the wrong task, and a wrong
 * answer acted on silently is worse than one extra question.
 */
export async function resolveAnswerTarget(
  hint?: string,
): Promise<{ kind: "one"; task: Task } | { kind: "many"; tasks: Task[] } | { kind: "none" }> {
  const open = await openQuestions();
  if (open.length === 0) return { kind: "none" };

  if (hint) {
    const h = hint.trim().toLowerCase();
    const byId = open.filter((t) => t.id.startsWith(h) || shortId(t.id) === h);
    if (byId.length === 1) return { kind: "one", task: byId[0] };
  }
  if (open.length === 1) return { kind: "one", task: open[0] };
  return { kind: "many", tasks: open };
}
