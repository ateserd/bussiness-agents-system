import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tasks, type Branch } from "@/db/schema";
import { runAgent } from "@/lib/agents/run";
import { getSetting } from "@/lib/settings";
import { claimQueued, type TaskPayload } from "@/lib/tasks";
import { dueRuns, runKeyFor, type PlannedRun } from "./cadences";

/**
 * One scheduler tick.
 *
 * Two sources of work meet here: the cadence table (time-driven) and the task
 * queue the manager delegates into (demand-driven). Both become the same unit
 * of work and run through one bounded pool.
 *
 * Idempotent: each due cadence run gets a `run_key` unique to agent + cadence +
 * minute, inserted with ON CONFLICT DO NOTHING, so a retrying cron or two
 * overlapping workers still do the work once. Queue tasks are claimed by a
 * conditional status transition, which is the same guarantee by a different
 * mechanism.
 *
 * Runs concurrently, bounded by `runtime.concurrency`. It used to be strictly
 * sequential, which meant one slow agent delayed every agent behind it and a
 * parked task would have held up the queue — the opposite of what parking is
 * for. Each slot has its own timeout and try/catch so one failure isolates.
 */

const TIMEOUT_MS = 120_000;
const RETRIES = 2;

export type TickResult = {
  due: number;
  ran: number;
  skipped: number;
  failed: number;
  parked: number;
  details: { agentId: string; outcome: string; note?: string }[];
};

/** One runnable thing, whether it came from the clock or from the manager. */
type Unit = {
  taskId: string;
  agentId: string;
  instruction: string;
  branch: Branch | null;
  label: string;
};

function backoff(attempt: number): number {
  return Math.min(16_000, 2 ** attempt * 1000);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`zaman aşımı (${ms}ms)`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

async function claim(run: PlannedRun, now: Date): Promise<string | null> {
  const db = await getDb();
  const id = randomUUID();
  const inserted = await db
    .insert(tasks)
    .values({
      id,
      agentId: run.agentId,
      title: run.label,
      status: "running",
      payload: { cadenceId: run.cadenceId, instruction: run.task, source: "schedule" },
      runKey: runKeyFor(run, now),
      scheduledFor: now,
      startedAt: now,
      attempts: 0,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();

  // Empty means another tick already claimed this exact slot.
  return inserted.length > 0 ? id : null;
}

/**
 * Lead retention, once a day, before anything else runs.
 *
 * This lives inside `tick()` rather than in a cadence because cadences run
 * *agents*, and a retention rule must not depend on an agent choosing to honour
 * it — or on a model being available at all. Google's terms allow keeping place
 * content only temporarily; an untouched lead is their data sitting in our
 * database, so it goes. A contacted lead, or one a deal points at, is a record
 * of our own business relationship and stays.
 *
 * Claimed through the same `tasks` run key as everything else, so the replay
 * window in `/api/tick` cannot run it twice in one day. A failure here is
 * logged and does not stop the tick: skipping scheduled work because a delete
 * failed would turn a housekeeping problem into an outage.
 */
async function runRetention(now: Date, result: TickResult): Promise<void> {
  const db = await getDb();
  const id = randomUUID();
  const day = now.toISOString().slice(0, 10);

  const claimed = await db
    .insert(tasks)
    .values({
      id,
      agentId: null,
      title: "Lead saklama süresi taraması",
      status: "running",
      payload: { kind: "retention", source: "system" },
      runKey: `retention:${day}`,
      scheduledFor: now,
      startedAt: now,
      attempts: 0,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();

  if (claimed.length === 0) return; // already done today

  try {
    const days = await getSetting("lead.retention_days");
    const { pruneLeads } = await import("@/lib/integrations/places");
    const pruned = await pruneLeads(now, days);
    await db
      .update(tasks)
      .set({ status: "done", attempts: 1, finishedAt: new Date() })
      .where(eq(tasks.id, id));
    if (pruned.deleted > 0) {
      result.details.push({
        agentId: "—",
        outcome: "retention",
        note: `${pruned.deleted} dokunulmamış lead silindi (${days} günü geçti), ${pruned.kept} kaldı`,
      });
    }
  } catch (err) {
    await db
      .update(tasks)
      .set({ status: "blocked", attempts: 1, lastError: (err as Error).message, finishedAt: new Date() })
      .where(eq(tasks.id, id));
  }
}

/** Run one unit, with retries, and settle its task row. */
async function runUnit(unit: Unit, result: TickResult): Promise<void> {
  const db = await getDb();
  let lastError: string | null = null;

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, backoff(attempt)));
    try {
      const outcome = await withTimeout(
        runAgent(unit.agentId, {
          trigger: "schedule",
          task: unit.instruction,
          taskId: unit.taskId,
          branch: unit.branch,
        }),
        TIMEOUT_MS,
      );

      // The run may have parked itself on a question. `ask_owner` already set
      // the row to `waiting_owner`; marking it done here would silently discard
      // the question and lose the work. Re-read before settling.
      const [current] = await db.select().from(tasks).where(eq(tasks.id, unit.taskId));
      if (current?.status === "waiting_owner") {
        result.parked++;
        result.details.push({ agentId: unit.agentId, outcome: "waiting_owner", note: current.question ?? undefined });
        return;
      }

      await db
        .update(tasks)
        .set({
          status: "done",
          attempts: attempt + 1,
          result: outcome.summary.slice(0, 500),
          finishedAt: new Date(),
        })
        .where(eq(tasks.id, unit.taskId));
      result.ran++;
      result.details.push({ agentId: unit.agentId, outcome: outcome.outcome });
      return;
    } catch (err) {
      lastError = (err as Error).message;
    }
  }

  // §7: post a blocker rather than dying silently.
  await db
    .update(tasks)
    .set({ status: "blocked", attempts: RETRIES + 1, lastError, finishedAt: new Date() })
    .where(eq(tasks.id, unit.taskId));
  const { agents } = await import("@/db/schema");
  await db
    .update(agents)
    .set({
      status: "blocked",
      blocker: `Çalışma ${RETRIES + 1} denemede başarısız: ${lastError}`,
    })
    .where(eq(agents.id, unit.agentId));
  result.failed++;
  result.details.push({ agentId: unit.agentId, outcome: "blocked", note: lastError ?? undefined });
}

export async function tick(now = new Date()): Promise<TickResult> {
  const due = dueRuns(now);
  const result: TickResult = {
    due: due.length,
    ran: 0,
    skipped: 0,
    failed: 0,
    parked: 0,
    details: [],
  };

  await runRetention(now, result);

  const units: Unit[] = [];

  // Time-driven work.
  for (const run of due) {
    const taskId = await claim(run, now);
    if (!taskId) {
      result.skipped++;
      continue;
    }
    units.push({
      taskId,
      agentId: run.agentId,
      instruction: run.task,
      branch: null,
      label: run.label,
    });
  }

  // Demand-driven work: whatever the manager delegated, plus anything the owner
  // answered since the last tick (answering re-queues the parked task).
  const concurrency = await getSetting("runtime.concurrency");
  const queued = await claimQueued(concurrency * 4);
  for (const t of queued) {
    if (!t.agentId) continue; // system housekeeping, not an agent run
    const payload = (t.payload ?? {}) as TaskPayload;
    const answered = t.answer ? `\n\nSahibin cevabı: ${t.answer}` : "";
    units.push({
      taskId: t.id,
      agentId: t.agentId,
      instruction: `${payload.instruction ?? t.title}${answered}`,
      branch: t.branch ?? null,
      label: t.title,
    });
  }

  result.due = units.length + result.skipped;
  await pool(units, concurrency, (unit) => runUnit(unit, result));

  return result;
}
