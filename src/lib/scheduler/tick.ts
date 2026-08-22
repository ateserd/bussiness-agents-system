import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tasks } from "@/db/schema";
import { runAgent } from "@/lib/agents/run";
import { dueRuns, runKeyFor, type PlannedRun } from "./cadences";

/**
 * One scheduler tick.
 *
 * Idempotent: each due run gets a `run_key` unique to agent + cadence + minute,
 * inserted with ON CONFLICT DO NOTHING. A tick that fires twice — a retrying
 * cron, two overlapping workers — does the work once.
 *
 * Each run has a timeout and two retries with backoff; on final failure it
 * writes a blocker rather than dying quietly (§7).
 */

const TIMEOUT_MS = 120_000;
const RETRIES = 2;

export type TickResult = {
  due: number;
  ran: number;
  skipped: number;
  failed: number;
  details: { agentId: string; outcome: string; note?: string }[];
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

async function claim(run: PlannedRun, now: Date): Promise<string | null> {
  const db = await getDb();
  const key = runKeyFor(run, now);
  const id = randomUUID();
  const inserted = await db
    .insert(tasks)
    .values({
      id,
      agentId: run.agentId,
      title: run.label,
      status: "running",
      payload: { cadenceId: run.cadenceId, task: run.task },
      runKey: key,
      scheduledFor: now,
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
      payload: { kind: "retention" },
      runKey: `retention:${day}`,
      scheduledFor: now,
      attempts: 0,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();

  if (claimed.length === 0) return; // already done today

  try {
    const { pruneLeads } = await import("@/lib/integrations/places");
    const pruned = await pruneLeads(now);
    await db.update(tasks).set({ status: "done", attempts: 1 }).where(eq(tasks.id, id));
    if (pruned.deleted > 0) {
      result.details.push({
        agentId: "—",
        outcome: "retention",
        note: `${pruned.deleted} dokunulmamış lead silindi (30 günü geçti), ${pruned.kept} kaldı`,
      });
    }
  } catch (err) {
    await db
      .update(tasks)
      .set({ status: "blocked", attempts: 1, lastError: (err as Error).message })
      .where(eq(tasks.id, id));
  }
}

export async function tick(now = new Date()): Promise<TickResult> {
  const db = await getDb();
  const due = dueRuns(now);
  const result: TickResult = { due: due.length, ran: 0, skipped: 0, failed: 0, details: [] };

  await runRetention(now, result);

  for (const run of due) {
    const taskId = await claim(run, now);
    if (!taskId) {
      result.skipped++;
      continue;
    }

    let lastError: string | null = null;
    let ok = false;

    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, backoff(attempt)));
      try {
        const outcome = await withTimeout(
          runAgent(run.agentId, { trigger: "schedule", task: run.task }),
          TIMEOUT_MS,
        );
        await db
          .update(tasks)
          .set({ status: "done", attempts: attempt + 1 })
          .where(eq(tasks.id, taskId));
        result.ran++;
        result.details.push({ agentId: run.agentId, outcome: outcome.outcome });
        ok = true;
        break;
      } catch (err) {
        lastError = (err as Error).message;
      }
    }

    if (!ok) {
      // §7: post a blocker rather than dying silently.
      await db
        .update(tasks)
        .set({ status: "blocked", attempts: RETRIES + 1, lastError })
        .where(eq(tasks.id, taskId));
      const { agents } = await import("@/db/schema");
      await db
        .update(agents)
        .set({
          status: "blocked",
          blocker: `Programlı çalışma ${RETRIES + 1} denemede başarısız: ${lastError}`,
        })
        .where(eq(agents.id, run.agentId));
      result.failed++;
      result.details.push({ agentId: run.agentId, outcome: "blocked", note: lastError ?? undefined });
    }
  }

  return result;
}
