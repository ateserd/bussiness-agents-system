import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { activity, agents, approvals, leads, type Department } from "@/db/schema";
import { markContacted } from "@/lib/integrations/places";
import { notifyOwner } from "@/lib/chat/notify";
import type { CalendarOp } from "@/lib/agents/tools";

/**
 * The one place an approval is settled.
 *
 * There used to be two. `decideApproval()` in `actions.ts` (the dashboard
 * button) marked the row approved and stopped; `/approve` on Telegram marked it
 * *and* dispatched. So approving from the dashboard looked identical, wrote the
 * same row, and silently never sent the email — a live bug with no error
 * anywhere, because both paths "succeeded".
 *
 * Two callers, one meaning, so there is one function. The rule this encodes:
 * settling an approval and acting on it are the same event, and nothing may
 * separate them again.
 */

export type SettleResult = { ok: boolean; message: string };

/**
 * Delivery for an approved `sending_external_messages` card.
 *
 * Approval clears the owner's gate — it says nothing about whether a provider
 * is wired to deliver. Only "email" has one; every other channel lands here
 * approved and stays manual, reported rather than silently dropped.
 */
async function dispatchOutreach(row: typeof approvals.$inferSelect): Promise<string> {
  const context = (row.context ?? {}) as { to?: string; channel?: string; subject?: string };
  if (context.channel !== "email") {
    return `${context.channel ?? "Bu kanal"} için otomatik gönderim yok — elle göndermen gerekiyor.`;
  }
  if (!context.to || !context.subject) {
    return "⚠️ Gönderilemedi: alıcı ya da konu eksik kaydedilmiş.";
  }

  const { sendEmail } = await import("@/lib/integrations/resend");
  const db = await getDb();
  const started = new Date();
  const result = await sendEmail({
    branch: row.branch,
    to: context.to,
    subject: context.subject,
    text: row.draft,
  });

  await db.insert(activity).values({
    id: randomUUID(),
    agentId: row.agentId,
    branch: row.branch,
    department: (row.agentId?.split(".")[1] ?? "outreach") as Department,
    action: "send_email",
    summary: result.ok
      ? `${context.to} adresine e-posta gönderildi.`
      : `${context.to} adresine gönderim başarısız: ${result.reason}`,
    reason: "Sahip onayladı.",
    input: { to: context.to, subject: context.subject },
    output: result.ok ? { resendId: result.id } : {},
    outcome: result.ok ? "success" : "failure",
    simulated: false,
    error: result.ok ? null : result.reason,
    startedAt: started,
    finishedAt: new Date(),
  });

  // Mark the lead contacted, or retention deletes the evidence that we wrote to
  // them: `pruneLeads()` drops any lead whose `contactedAt` is null once it is
  // old enough, which would take the "we already approached them" history with
  // it and invite a second cold email to the same business.
  if (result.ok) {
    const [lead] = await db.select().from(leads).where(eq(leads.email, context.to));
    if (lead) await markContacted(lead.id);
  }

  return result.ok ? "✓ Gönderildi." : `⚠️ Gönderilemedi: ${result.reason}`;
}

/**
 * Execution for an approved `changing_calendar` card.
 *
 * The owner's rule for the calendar is two rules at once: full authority over
 * it, and nothing created, moved or cancelled without being asked on Telegram
 * first. The ask lives in the gated tool; this is the other half — the work
 * happens only after he has said yes, and it happens here, once, so there is no
 * second way to reach Google.
 *
 * "Yaptığı her şeyi de raporlasın" is why this returns prose and writes an
 * `activity` row for every branch, success or failure. The row is the durable
 * record; the string is what he reads on his phone.
 */
async function dispatchCalendar(row: typeof approvals.$inferSelect): Promise<string> {
  const op = ((row.context ?? {}) as { calendar?: CalendarOp }).calendar;
  if (!op) return "⚠️ Takvim işlemi eksik kaydedilmiş — hiçbir şey yapılmadı.";

  const calendar = await import("@/lib/integrations/google-calendar");
  const db = await getDb();
  const started = new Date();

  let report: string;
  let ok: boolean;

  if (op.op === "create") {
    const res = await calendar.createMeeting({
      title: op.title,
      startsAt: op.startsAt,
      durationMin: op.durationMin,
      attendeeEmails: op.attendees,
      description: op.description,
      withMeet: op.withMeet,
    });
    ok = res.ok;
    report = res.ok
      ? [
          `📅 Toplantı oluşturuldu — ${res.meeting.summary}`,
          calendar.describe(res.meeting),
          res.meeting.attendees.length > 0
            ? `Davet gönderildi: ${res.meeting.attendees.join(", ")}`
            : "Katılımcı yok — yalnızca senin takvimine eklendi.",
        ].join("\n")
      : `⚠️ Toplantı oluşturulamadı (${res.reason}). Takvimde hiçbir değişiklik olmadı.`;
  } else if (op.op === "update") {
    const res = await calendar.updateMeeting({
      eventId: op.eventId,
      title: op.title,
      startsAt: op.startsAt,
      durationMin: op.durationMin,
      attendeeEmails: op.attendees,
    });
    ok = res.ok;
    report = res.ok
      ? [`📅 Toplantı güncellendi — ${op.label}`, calendar.describe(res.meeting), "Katılımcılara güncelleme gitti."].join("\n")
      : `⚠️ Toplantı güncellenemedi (${res.reason}). Takvimde hiçbir değişiklik olmadı.`;
  } else {
    const res = await calendar.cancelMeeting(op.eventId);
    ok = res.ok;
    report = res.ok
      ? `📅 Toplantı iptal edildi — ${op.label}. Katılımcılara iptal bildirimi gitti.`
      : `⚠️ Toplantı iptal edilemedi (${res.reason}). Takvimde hiçbir değişiklik olmadı.`;
  }

  await db.insert(activity).values({
    id: randomUUID(),
    agentId: row.agentId,
    branch: row.branch,
    department: (row.agentId?.split(".")[1] ?? "ops") as Department,
    action: `calendar_${op.op}`,
    summary: report.slice(0, 900),
    reason: "Sahip onayladı.",
    input: { ...op },
    output: {},
    outcome: ok ? "success" : "failure",
    simulated: false,
    error: ok ? null : report,
    startedAt: started,
    finishedAt: new Date(),
  });

  return report;
}

export async function settleApproval(
  approvalId: string,
  decision: "approved" | "rejected",
  reason?: string,
  /**
   * Where the decision came from. Only affects whether the outcome is *pushed*
   * to Telegram: settling from chat already answers in the same thread, so
   * pushing again would report the same thing twice. From the dashboard there
   * is nowhere else the report would appear.
   */
  via: "chat" | "dashboard" = "dashboard",
): Promise<SettleResult> {
  const db = await getDb();
  const [row] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
  if (!row) return { ok: false, message: `Onay kaydı bulunamadı: ${approvalId}` };
  if (row.state !== "pending") return { ok: false, message: `Bu kayıt zaten ${row.state}.` };

  await db
    .update(approvals)
    .set({
      state: decision,
      decidedAt: new Date(),
      rejectionReason: decision === "rejected" ? (reason ?? null) : null,
    })
    .where(eq(approvals.id, approvalId));

  // Releasing one gate returns the agent to idle only if nothing else of its
  // own is still waiting — otherwise the tree stops asking for a card that is
  // still open. The chat path used to skip this check and clear the status
  // regardless.
  if (row.agentId) {
    const remaining = await db.select().from(approvals).where(eq(approvals.agentId, row.agentId));
    const stillPending = remaining.some((a) => a.id !== approvalId && a.state === "pending");
    if (!stillPending) {
      await db.update(agents).set({ status: "idle" }).where(eq(agents.id, row.agentId));
    }
  }

  const verdict = `${row.title} — ${decision === "approved" ? "onaylandı" : "reddedildi"}.`;
  if (decision === "rejected") return { ok: true, message: verdict };

  if (row.gate === "sending_external_messages") {
    return { ok: true, message: `${verdict}\n${await dispatchOutreach(row)}` };
  }
  if (row.gate === "changing_calendar") {
    const report = await dispatchCalendar(row);
    if (via !== "chat") await notifyOwner(report);
    return { ok: true, message: `${verdict}\n${report}` };
  }
  return { ok: true, message: verdict };
}
