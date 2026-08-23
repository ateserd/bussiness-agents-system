import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { approvals, tasks } from "@/db/schema";
import { clip } from "@/lib/chat/notify";
import { describePlan, type Plan } from "./plan";

/**
 * The day's outreach as one message, and the map that lets one reply settle it.
 *
 * Per-card approval was the wrong granularity, not the wrong idea: ten drafts
 * meant ten notifications and ten decisions on a phone. What the gate
 * guarantees — nothing reaches a stranger without the owner saying so — is
 * untouched here. Only the asking changes: one message, one answer, and every
 * item still goes out through `settleApproval` exactly as a single card would.
 *
 * The batch lives in a `tasks` row rather than a table of its own, because it
 * *is* a unit of work with a payload and a once-a-day run key — which is what
 * that table is for. The payload holds the numbering, and the numbering is the
 * whole trick: the owner answers "3 hariç", not a uuid.
 */

/** How far back `openBatch` looks. A week of batches is more than enough. */
const BATCH_LOOKBACK = 7;

/** The batch task's title, which is also how it is found again. */
export const BATCH_TITLE = "Günün gönderim partisi";

/** Telegram's hard limit is 4096; the margin absorbs the header and footer. */
const MESSAGE_BUDGET = 3800;
const DRAFT_SLICE = 150;

export type MailItem = { n: number; approvalId: string; leadId: string | null; company: string; to: string };
export type CallItem = {
  ref: string;
  leadId: string | null;
  company: string;
  phone: string;
  hook: string;
  script: string;
};

export type BatchPayload = {
  kind: "outreach_batch";
  day: string;
  mail: MailItem[];
  call: CallItem[];
  planLine: string;
  source: string;
};

export function batchRunKey(day: string): string {
  return `outreach:${day}`;
}

/** Letters for the call list, so "3" is never ambiguous between the two lists. */
export function callRef(index: number): string {
  return String.fromCharCode(65 + index); // A, B, C…
}

export async function saveBatch(input: {
  taskId: string;
  day: string;
  plan: Plan;
  mail: MailItem[];
  call: CallItem[];
}): Promise<BatchPayload> {
  const db = await getDb();
  const payload: BatchPayload = {
    kind: "outreach_batch",
    day: input.day,
    mail: input.mail,
    call: input.call,
    planLine: describePlan(input.plan),
    source: "system",
  };
  await db
    .update(tasks)
    .set({ payload, result: `${input.mail.length} mail · ${input.call.length} arama` })
    .where(eq(tasks.id, input.taskId));
  return payload;
}

export type OpenBatch = { taskId: string; payload: BatchPayload; pending: MailItem[] };

/**
 * The most recent batch that still has something to decide.
 *
 * "Still open" is read from the approval rows, not from a flag on the batch:
 * the owner can also settle an item the old way with `/approve <id>`, and a
 * flag would then disagree with reality. A batch whose mail items are all
 * decided is closed even though nothing marked it so.
 *
 * Two queries, fixed — the pending outreach approvals once, the recent batches
 * once, matched in memory. It used to walk batches and fire a fresh approvals
 * query per batch, up to eight round trips; on Supabase that is eight, on every
 * manager message, to produce one clause of one line in the system map.
 */
export async function openBatch(): Promise<OpenBatch | null> {
  const db = await getDb();

  const [pending, recent] = await Promise.all([
    db
      .select({ id: approvals.id })
      .from(approvals)
      .where(and(eq(approvals.state, "pending"), eq(approvals.gate, "sending_external_messages"))),
    db
      .select()
      .from(tasks)
      .where(eq(tasks.title, BATCH_TITLE))
      .orderBy(desc(tasks.createdAt))
      .limit(BATCH_LOOKBACK),
  ]);

  if (pending.length === 0) return null;
  const openIds = new Set(pending.map((a) => a.id));

  for (const row of recent) {
    const payload = row.payload as BatchPayload | null;
    if (!payload || payload.kind !== "outreach_batch") continue;
    const open = payload.mail.filter((m) => openIds.has(m.approvalId));
    if (open.length === 0) continue;
    return { taskId: row.id, payload, pending: open };
  }
  return null;
}

/** A fresh batch task row, claimed once per day by its run key. */
export async function claimBatchTask(day: string, now: Date): Promise<string | null> {
  const db = await getDb();
  const id = randomUUID();
  const inserted = await db
    .insert(tasks)
    .values({
      id,
      agentId: null,
      title: BATCH_TITLE,
      status: "running",
      payload: { kind: "outreach_batch", day, source: "system" },
      runKey: batchRunKey(day),
      scheduledFor: now,
      startedAt: now,
      attempts: 0,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();
  return inserted.length > 0 ? id : null;
}

/**
 * The message itself.
 *
 * Two lists, deliberately numbered differently: mail is 1,2,3 and needs a
 * decision, calls are A,B,C and need none — they are his to make. Sharing one
 * numbering would make "3 hariç" ambiguous the first time a call list is
 * longer than the mail list.
 */
export function renderBatch(payload: BatchPayload, drafts: Map<string, string>): string {
  const lines: string[] = [];
  const dayLabel = new Date(`${payload.day}T12:00:00`).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
  });

  lines.push(`📮 ${dayLabel} — günün listesi`);
  lines.push(`Plan: ${payload.planLine}`);

  if (payload.mail.length > 0) {
    lines.push("");
    lines.push("MAİL — onayını bekliyor");
    for (const item of payload.mail) {
      const draft = drafts.get(item.approvalId) ?? "";
      lines.push(`${String(item.n).padStart(2, " ")}. ${item.company} · ${item.to}`);
      if (draft) lines.push(`    "${clip(draft.replace(/\s+/g, " "), DRAFT_SLICE)}"`);
    }
  }

  if (payload.call.length > 0) {
    lines.push("");
    lines.push("ARAMA — sen arayacaksın, onay gerekmiyor");
    for (const item of payload.call) {
      lines.push(` ${item.ref}. ${item.company} · ${item.phone}`);
      if (item.hook) lines.push(`    ${clip(item.hook.replace(/\s+/g, " "), DRAFT_SLICE)}`);
    }
  }

  if (payload.mail.length === 0 && payload.call.length === 0) {
    lines.push("");
    lines.push("Bugün gönderilecek bir şey çıkmadı.");
    return lines.join("\n");
  }

  lines.push("");
  if (payload.mail.length > 0) {
    lines.push(`Cevabın: "gönder" · "${payload.mail.length > 2 ? "3 hariç" : "1 hariç"}" · "1,2" · "iptal"`);
  }
  if (payload.call.length > 0) {
    lines.push(`Arama metni için: "${payload.call[0].ref} metnini ver"`);
  }

  const text = lines.join("\n");
  // Better a truncated list with a truthful last line than a message Telegram
  // silently refuses to deliver.
  return text.length <= MESSAGE_BUDGET
    ? text
    : `${text.slice(0, MESSAGE_BUDGET)}\n… (liste kesildi — tamamı panelde)`;
}

/** Full text for one item, for "2'nin tamamını göster" / "A metnini ver". */
export async function itemDetail(batch: OpenBatch, ref: string): Promise<string | null> {
  const key = ref.trim().toUpperCase();

  const call = batch.payload.call.find((c) => c.ref === key);
  if (call) {
    return [
      `${call.company} · ${call.phone}`,
      "",
      call.script || call.hook || "(metin kaydedilmemiş)",
    ].join("\n");
  }

  const mail = batch.payload.mail.find((m) => String(m.n) === key);
  if (!mail) return null;
  const db = await getDb();
  const [row] = await db.select().from(approvals).where(eq(approvals.id, mail.approvalId));
  if (!row) return null;
  return [`${mail.company} · ${mail.to}`, "", row.draft].join("\n");
}
