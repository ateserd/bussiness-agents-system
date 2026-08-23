import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { activity, leads } from "@/db/schema";
import { settleApproval } from "@/lib/approvals";
import type { MailItem, OpenBatch } from "./batch";

/**
 * One answer, applied to the whole day.
 *
 * Each item still goes through `settleApproval` — the same function a single
 * `/approve` calls — so nothing here is a second way to send. What this adds is
 * the arithmetic ("3 hariç" over a list of seven) and, more importantly, the
 * report: how many went, how many were held back, and which one failed at the
 * provider rather than at the gate. Those are different outcomes and collapsing
 * them into "gönderildi" would be the kind of quiet lie this system exists to
 * avoid.
 */

export type Decision = "send_all" | "send_only" | "send_except" | "cancel";

/** Which items the answer selects for sending, and which for rejection. */
function split(pending: MailItem[], action: Decision, numbers: number[]) {
  const picked = new Set(numbers);
  switch (action) {
    case "send_all":
      return { send: pending, reject: [] as MailItem[] };
    case "cancel":
      return { send: [] as MailItem[], reject: pending };
    case "send_only":
      return { send: pending.filter((m) => picked.has(m.n)), reject: pending.filter((m) => !picked.has(m.n)) };
    case "send_except":
      return { send: pending.filter((m) => !picked.has(m.n)), reject: pending.filter((m) => picked.has(m.n)) };
  }
}

export async function applyBatchDecision(
  batch: OpenBatch,
  action: Decision,
  numbers: number[],
  reason: string | undefined,
  byAgentId: string,
): Promise<string> {
  const db = await getDb();
  const known = new Set(batch.pending.map((m) => m.n));
  const unknown = numbers.filter((n) => !known.has(n));
  const { send, reject } = split(batch.pending, action, numbers);

  const sent: string[] = [];
  const failed: string[] = [];
  for (const item of send) {
    const result = await settleApproval(item.approvalId, "approved", undefined, "chat");
    // The approval is settled either way; what can still fail is delivery, and
    // the owner needs to know which of the two happened.
    if (result.ok && !result.message.includes("⚠️")) sent.push(item.company);
    else failed.push(`${item.company} (${result.message.split("\n").pop()})`);
  }

  const held: string[] = [];
  for (const item of reject) {
    await settleApproval(item.approvalId, "rejected", reason, "chat");
    held.push(item.company);
  }

  const lines: string[] = [];
  if (sent.length > 0) lines.push(`✓ ${sent.length} gönderildi: ${sent.join(", ")}`);
  if (failed.length > 0) lines.push(`⚠️ ${failed.length} gidemedi: ${failed.join(" · ")}`);
  if (held.length > 0) {
    // The two rejection meanings, said out loud — the owner chose this rule and
    // should be able to see it being applied rather than infer it later.
    const fate = reason
      ? `gerekçeni yazdım, yarın düzeltilmiş taslakla dönecekler`
      : `gerekçe yazmadın, bir daha listeye girmeyecekler`;
    lines.push(`✗ ${held.length} gönderilmedi (${fate}): ${held.join(", ")}`);
  }
  if (unknown.length > 0) lines.push(`? Listede olmayan numara: ${unknown.join(", ")}`);
  if (lines.length === 0) lines.push("Bu partide karar bekleyen bir şey kalmamıştı.");

  const remaining = batch.payload.mail.length - send.length - reject.length;
  if (remaining > 0) lines.push(`${remaining} madde hâlâ açık.`);

  const summary = lines.join("\n");
  await db.insert(activity).values({
    id: randomUUID(),
    agentId: byAgentId,
    branch: "shared",
    department: "outreach",
    action: "outreach_batch_settled",
    summary: summary.slice(0, 900),
    reason: `Sahibin partiye cevabı: ${action}${numbers.length ? ` (${numbers.join(",")})` : ""}`,
    input: { action, numbers, reason: reason ?? null, day: batch.payload.day },
    output: { sent: sent.length, failed: failed.length, held: held.length },
    // A batch where six of seven went out is not a failed batch; it is a
    // successful one with a named casualty, and `error` is where the casualty
    // is recorded so it stays queryable.
    outcome: sent.length === 0 && failed.length > 0 ? "failure" : "success",
    error: failed.length > 0 ? failed.join(" · ").slice(0, 900) : null,
    simulated: false,
    startedAt: new Date(),
    finishedAt: new Date(),
  });

  return summary;
}

/**
 * The other half of the owner's rejection rule, applied to the lead itself.
 *
 * A bare "iptal" means never show me this business again; a rejection *with* a
 * reason means show me a better draft tomorrow. Both are recorded on the lead,
 * because the decision has to survive the approval row it was made on.
 */
export async function recordRejection(leadId: string, reason: string | undefined): Promise<void> {
  const db = await getDb();
  const trimmed = (reason ?? "").trim();
  // "Sebep belirtilmedi" is what the `/reject` parser fills in when the owner
  // gave none, so it means the same thing as an empty string here.
  const bare = !trimmed || /^(iptal|sebep belirtilmedi|hay[ıi]r|yok)$/i.test(trimmed);
  await db
    .update(leads)
    .set(bare ? { rejectedAt: new Date(), rejectionNote: null } : { rejectionNote: trimmed })
    .where(eq(leads.id, leadId));
}
