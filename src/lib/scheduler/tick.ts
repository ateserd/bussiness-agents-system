import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { activity, approvals, conversations, tasks, type Branch } from "@/db/schema";
import { notifyOwner, sendLong } from "@/lib/chat/notify";
import { buildBrief, composeBrief, narrateBrief, renderBrief } from "@/lib/brief";
import { getDayActivity } from "@/lib/data";
import { callRef, claimBatchTask, renderBatch, saveBatch, type CallItem, type MailItem } from "@/lib/outreach/batch";
import { dayKey } from "@/lib/outreach/plan";
import { briefLead, selectForDay } from "@/lib/outreach/select";
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

/** Minutes since midnight in the owner's timezone, not the server's. */
function minutesNow(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return get("hour") * 60 + get("minute");
}

/**
 * Has an `HH:MM` setting's moment passed today?
 *
 * "At or after", never "exactly at": the tick fires on a timer that can drift
 * or be started late, so an equality check would skip 09:00 entirely on a tick
 * that happened to land at 09:07. What keeps these to once a day is the run
 * key, not the minute.
 */
function isPast(now: Date, hhmm: string, fallbackMinutes: number): boolean {
  const [hh, mm] = hhmm.split(":").map(Number);
  const due = Number.isFinite(hh) && Number.isFinite(mm) ? hh * 60 + mm : fallbackMinutes;
  return minutesNow(now) >= due;
}

/**
 * One system-owned, once-a-day step. Claims by run key, runs `body`, and
 * settles the row either way.
 *
 * Three of these now exist — retention, the outreach batch, the brief — and
 * each needs the same guarantee: exactly once per day even if the tick runs
 * every minute, and a failure that is recorded rather than one that takes the
 * whole tick down with it.
 */
async function onceToday(
  key: string,
  title: string,
  now: Date,
  result: TickResult,
  body: (taskId: string) => Promise<{ outcome: string; note?: string }>,
): Promise<void> {
  const db = await getDb();
  const id = randomUUID();
  const claimed = await db
    .insert(tasks)
    .values({
      id,
      agentId: null,
      title,
      status: "running",
      payload: { kind: key.split(":")[0], source: "system" },
      runKey: key,
      scheduledFor: now,
      startedAt: now,
      attempts: 0,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (claimed.length === 0) return;

  try {
    const out = await body(id);
    await db
      .update(tasks)
      .set({ status: "done", attempts: 1, result: out.note?.slice(0, 500) ?? null, finishedAt: new Date() })
      .where(eq(tasks.id, id));
    result.details.push({ agentId: "—", outcome: out.outcome, note: out.note });
  } catch (err) {
    await db
      .update(tasks)
      .set({ status: "blocked", attempts: 1, lastError: (err as Error).message, finishedAt: new Date() })
      .where(eq(tasks.id, id));
    result.details.push({ agentId: "—", outcome: "blocked", note: `${title}: ${(err as Error).message}` });
  }
}

/**
 * Rows a dead process left behind.
 *
 * `runUnit` settles a run that throws. It cannot settle one whose process
 * vanished — systemd restart, OOM, a reclaimed container — and that row stays
 * `running` for good: the system map keeps counting it, the dashboard keeps
 * showing an agent that stopped days ago. Nothing else in the system ever looks
 * at those rows again, so this is the only thing that can put the record back
 * in touch with reality.
 *
 * It runs no agent and makes no judgement, which is why it lives here rather
 * than in a cadence.
 *
 * **Every tick, not once a day.** It used to be an `onceToday` step next to
 * retention, and that conflated two different things: retention is a daily
 * *policy* (leads older than N days go), while this is a *repair* (the record
 * disagrees with reality). Gating a repair to once a day meant a row orphaned
 * at 10:00 kept the dashboard saying "çalışıyor" until the next morning — the
 * exact lie this function exists to prevent. It costs one indexed query per
 * tick and calls no model, so there is nothing to save by rationing it.
 *
 * No task row is written when there is nothing to reap: at a fifteen-minute
 * cadence that would be ninety-six rows a day of "checked, nothing found".
 * A reap that actually closes something reports it on the tick result.
 *
 * The cutoff has to be well past the run timeout, or a slow-but-live run gets
 * declared dead underneath itself.
 */
const STALE_RUN_MS = TIMEOUT_MS * 6;

async function reapStaleRuns(now: Date, result: TickResult): Promise<void> {
  // Its own try/catch, which `onceToday` used to provide: a failing repair must
  // not take down the tick that would have run the real work.
  try {
    const { staleRunning } = await import("@/lib/tasks");
    const db = await getDb();
    const stale = await staleRunning(now, STALE_RUN_MS);
    if (stale.length === 0) return;

    for (const task of stale) {
      await db
        .update(tasks)
        .set({
          status: "blocked",
          lastError: "Süreç çalışma sırasında sonlandı — sonucu bilinmiyor.",
          finishedAt: now,
        })
        .where(eq(tasks.id, task.id));
    }
    result.details.push({
      agentId: "—",
      outcome: "reap",
      note: `${stale.length} yarım kalmış çalışma kapatıldı`,
    });
  } catch (err) {
    result.details.push({
      agentId: "—",
      outcome: "blocked",
      note: `Yarım kalmış çalışma taraması: ${(err as Error).message}`,
    });
  }
}

/**
 * The morning brief, pushed rather than waited for.
 *
 * It used to exist only as `/brief` — something the owner had to remember to
 * ask for, which is the opposite of a brief. The manager's YAML carried a
 * `schedule: "30 7 * * *"`, but that fired the *generic* scheduled-run text,
 * not this; and `brief.time` was a setting nothing read. Both are settled here:
 * the hour comes from the setting, and the manager's own cron is gone so it
 * cannot run twice.
 */
async function runMorningBrief(now: Date, result: TickResult): Promise<void> {
  if (!isPast(now, await getSetting("brief.time"), 7 * 60 + 30)) return;

  await onceToday(`brief:${dayKey(now)}`, "Sabah brifingi", now, result, async (taskId) => {
    const brief = await buildBrief(now);
    const narration = await narrateBrief(brief, "morning").catch(() => null);
    await sendLong(narration ? `${narration}\n\n${renderBrief(brief)}` : renderBrief(brief));

    // Stored so the panel can show the framing without paying for it again —
    // see `todaysNarration`. Produced here, once a day, and nowhere else.
    if (narration) {
      const db = await getDb();
      await db
        .update(tasks)
        .set({ payload: { kind: "brief", source: "system", narration } })
        .where(eq(tasks.id, taskId));
    }
    return {
      outcome: "brief",
      note: `${brief.active.length} aktif · ${brief.potential.length} fırsat · ${brief.quiet.length} sessiz · ${brief.needsYou.length} sana düşen`,
    };
  });
}

/**
 * The evening wrap, and its one rule: on a quiet day it does not arrive.
 *
 * The owner asked for exactly that, so "was today eventful" is counted from
 * activity rows rather than judged by a model — a summary that decides for
 * itself whether the day felt worth mentioning would arrive every day. The task
 * row is still written on a silent day, which is how "we checked and there was
 * nothing" stays distinguishable from "the scheduler never ran".
 */
async function runEveningWrap(now: Date, result: TickResult): Promise<void> {
  if (!isPast(now, await getSetting("brief.evening_time"), 19 * 60)) return;

  await onceToday(`evening:${dayKey(now)}`, "Gün sonu özeti", now, result, async () => {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = await getDayActivity(midnight);
    if (!day.eventful) return { outcome: "evening", note: "sessiz gün — mesaj gönderilmedi" };

    const brief = await buildBrief(now);
    await sendLong(await composeBrief(brief, "evening"));
    return {
      outcome: "evening",
      note: `${day.sent} gitti · ${day.tasksDone} görev bitti · ${day.approvalsSettled} onay kapandı`,
    };
  });
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
  await onceToday(`retention:${dayKey(now)}`, "Saklama süresi taraması", now, result, async () => {
    const db = await getDb();
    const notes: string[] = [];

    const leadDays = await getSetting("lead.retention_days");
    const { pruneLeads } = await import("@/lib/integrations/places");
    const pruned = await pruneLeads(now, leadDays);
    if (pruned.deleted > 0) {
      notes.push(`${pruned.deleted} dokunulmamış lead silindi (${leadDays} gün), ${pruned.kept} kaldı`);
    }

    // Chat history. Bounded because it is a transcript, not a record: what the
    // owner decided lives in settings, memory and the approval trail, all of
    // which outlive this.
    const chatDays = await getSetting("chat.retention_days");
    const chatCutoff = new Date(now.getTime() - chatDays * 86_400_000);
    const [chatDue] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(conversations)
      .where(lt(conversations.createdAt, chatCutoff));
    if ((chatDue?.n ?? 0) > 0) {
      await db.delete(conversations).where(lt(conversations.createdAt, chatCutoff));
      notes.push(`${chatDue.n} eski sohbet mesajı silindi`);
    }

    /*
     * Activity is thinned, never deleted.
     *
     * This table is the audit trail — what an agent actually did, what it cost,
     * what it sent — and that has to outlive everything else, so no row goes.
     * What makes it *large* is the verbatim prompt and output carried on each
     * row, and those stop being worth their bytes long before the record does.
     * Old rows keep their summary, outcome, cost and timing; they lose the
     * transcript.
     */
    const detailDays = await getSetting("activity.detail_days");
    const detailCutoff = new Date(now.getTime() - detailDays * 86_400_000);
    const fat = and(lt(activity.startedAt, detailCutoff), isNotNull(activity.output));
    const [detailDue] = await db.select({ n: sql<number>`count(*)::int` }).from(activity).where(fat);
    if ((detailDue?.n ?? 0) > 0) {
      await db.update(activity).set({ input: null, output: null }).where(fat);
      notes.push(`${detailDue.n} eski hareket kaydının tam metni boşaltıldı`);
    }

    /*
     * Stale approvals expire.
     *
     * A cold-mail draft approved three weeks after it was written sends a stale
     * email to a business whose situation has moved on — and the owner reading
     * `/approve <id>` has no way to see the age from the card. Expiring is not
     * deciding for him: an expired card can be regenerated, an email cannot be
     * recalled.
     */
    const staleDays = await getSetting("approval.stale_days");
    const staleCutoff = new Date(now.getTime() - staleDays * 86_400_000);
    const stale = and(eq(approvals.state, "pending"), lt(approvals.createdAt, staleCutoff));
    const [staleDue] = await db.select({ n: sql<number>`count(*)::int` }).from(approvals).where(stale);
    if ((staleDue?.n ?? 0) > 0) {
      await db
        .update(approvals)
        .set({
          state: "rejected",
          decidedAt: now,
          rejectionReason: `${staleDays} gün içinde karar verilmedi — bayatladı, gönderilmedi.`,
        })
        .where(stale);
      notes.push(`${staleDue.n} bekleyen onay bayatladı ve kapatıldı`);
      await notifyOwner(
        `🗑 ${staleDue.n} onay kartı ${staleDays} gündür bekliyordu ve bayatladı — hiçbiri gönderilmedi. ` +
          "Hâlâ istiyorsan yeniden hazırlatabilirim.",
      );
    }

    return { outcome: "retention", note: notes.length > 0 ? notes.join(" · ") : undefined };
  });
}

/**
 * The day's outreach, prepared and asked about once.
 *
 * Lives here rather than in the cadence table for the same reason retention
 * does — and one more. Retention must not depend on an agent remembering it;
 * this must not depend on a *static cron*, because the hour it runs at is a
 * setting the owner changes by saying so, and `dueRuns()` reads cron strings
 * frozen in YAML.
 *
 * The whole day happens inside one tick, deliberately. Splitting "write the
 * drafts" and "ask about them" across two ticks would put an hour between the
 * two halves of one morning, and leave a window where ten cards sit pending
 * with nothing announcing them.
 *
 * Order matters and is enforced by code, not by prompt: the plan decides how
 * many, `selectForDay` decides which leads, and only then does a model get
 * involved — to write. A cap a model could exceed would not be a cap.
 */
async function runOutreachBatch(now: Date, result: TickResult): Promise<void> {
  const db = await getDb();
  const day = dayKey(now);

  if (!isPast(now, await getSetting("outreach.batch_time"), 9 * 60)) return;

  const taskId = await claimBatchTask(day, now);
  if (!taskId) return; // already prepared today

  try {
    const selection = await selectForDay(day);
    const { plan } = selection;

    if (plan.skip) {
      // Skipping is a thing that was done, so it is reported. A silent skip is
      // indistinguishable from a broken scheduler.
      const said = plan.sourceText ? ` Senin sözlerin: "${plan.sourceText}"` : "";
      await notifyOwner(`📮 ${day} — bugün gönderim hazırlamadım, sen öyle dedin.${said}`);
      await db
        .update(tasks)
        .set({ status: "done", result: "atlandı (sahibin isteği)", finishedAt: new Date() })
        .where(eq(tasks.id, taskId));
      result.details.push({ agentId: "—", outcome: "outreach", note: "bugün atlandı (sahibin isteği)" });
      return;
    }

    const mail: MailItem[] = [];
    const call: CallItem[] = [];
    let shortfall: string | null = null;

    if (selection.mail.length > 0 || selection.call.length > 0) {
      const writer = "shared.outreach.writer";
      const instruction = [
        `Bugünün gönderim listesi hazırlanıyor (${day}).`,
        plan.focus ? `Sahibin bugüne özel yönlendirmesi: ${plan.focus}` : "",
        "",
        selection.mail.length > 0
          ? [
              `MAİL YAZILACAK (${selection.mail.length} adet) — her biri için outreach_send çağır,`,
              "leadId ve company alanlarını aşağıdaki değerlerle doldur:",
              ...selection.mail.map((l) => `  - leadId: ${l.id} | ${briefLead(l)}`),
            ].join("\n")
          : "Bugün mail yazılmayacak.",
        "",
        selection.call.length > 0
          ? [
              `ARAMA METNİ YAZILACAK (${selection.call.length} adet) — her biri için call_script çağır:`,
              ...selection.call.map((l) => `  - leadId: ${l.id} | ${briefLead(l)}`),
            ].join("\n")
          : "Bugün arama metni yazılmayacak.",
        "",
        "Listenin dışına çıkma, sayıyı aşma, kendi lead'ini ekleme. Hiçbiri gönderilmiyor —",
        "hepsi sahibin tek onayını bekleyecek.",
      ]
        .filter(Boolean)
        .join("\n");

      const run = await withTimeout(
        runAgent(writer, { trigger: "schedule", task: instruction, taskId, batchMode: true }),
        TIMEOUT_MS * 2,
      );

      // What the writer actually produced, read from the rows rather than from
      // its own account of itself.
      const written = await db
        .select()
        .from(approvals)
        .where(and(eq(approvals.activityId, run.activityId), eq(approvals.state, "pending")));
      written.forEach((row, i) => {
        const ctx = (row.context ?? {}) as { to?: string; leadId?: string; company?: string };
        mail.push({
          n: i + 1,
          approvalId: row.id,
          leadId: ctx.leadId ?? null,
          company: ctx.company ?? ctx.to ?? row.title,
          to: ctx.to ?? "—",
        });
      });
      run.callScripts.forEach((c, i) => call.push({ ref: callRef(i), ...c }));

      // Leads went in and nothing came out. Reporting that as "havuzda uygun
      // lead yok" would blame the lead list for a writing failure — and in
      // simulate mode it would do so every single morning.
      if (selection.mail.length > 0 && mail.length === 0) {
        shortfall = run.simulated
          ? `⚠️ ${selection.mail.length} lead seçildi ama taslak yazılamadı: model çalışmıyor (ANTHROPIC_API_KEY yok).`
          : `⚠️ ${selection.mail.length} lead seçildi ama taslak çıkmadı: ${run.summary.slice(0, 200)}`;
      }
    }

    const payload = await saveBatch({ taskId, day, plan, mail, call });
    const drafts = new Map(
      mail.length > 0
        ? (await db.select().from(approvals).where(inArray(approvals.id, mail.map((m) => m.approvalId)))).map(
            (r) => [r.id, r.draft] as const,
          )
        : [],
    );
    await notifyOwner([renderBatch(payload, drafts), shortfall, `(${selection.note})`].filter(Boolean).join("\n\n"));

    await db
      .update(tasks)
      .set({ status: "done", finishedAt: new Date() })
      .where(eq(tasks.id, taskId));
    result.details.push({
      agentId: "—",
      outcome: shortfall ? "outreach_partial" : "outreach",
      note: shortfall ?? `${mail.length} mail · ${call.length} arama hazırlandı`,
    });
  } catch (err) {
    await db
      .update(tasks)
      .set({ status: "blocked", lastError: (err as Error).message, finishedAt: new Date() })
      .where(eq(tasks.id, taskId));
    result.details.push({ agentId: "—", outcome: "blocked", note: `parti hazırlanamadı: ${(err as Error).message}` });
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
  await reapStaleRuns(now, result);
  await runOutreachBatch(now, result);
  await runMorningBrief(now, result);
  await runEveningWrap(now, result);

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
