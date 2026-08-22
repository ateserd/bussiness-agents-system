import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { activity, agents, approvals } from "@/db/schema";
import { allAgents, getAgent } from "@/lib/agents/registry";
import { buildBrief, renderBrief } from "@/lib/brief";
import { writeMemory } from "@/lib/brain/write";
import { fmt } from "@/lib/copy";

/**
 * The §6 command set, parsed once and shared by every channel.
 *
 * The Telegram route is a thin transport over this; `npm run brief` uses the
 * same code. When a real chat channel is wired up (SETUP_TODO → Telegram), it
 * is a transport change, not a rewrite.
 */

export type Command =
  | { kind: "brief" }
  | { kind: "branch"; branch: "web" | "automation" }
  | { kind: "approve"; id: string }
  | { kind: "reject"; id: string; reason: string }
  | { kind: "pause"; agent: string }
  | { kind: "run"; agent: string }
  | { kind: "remember"; fact: string; scope: string }
  | { kind: "blockers" }
  | { kind: "ask"; text: string };

/**
 * `/remember web: ...` writes to that branch; a bare `/remember ...` stays
 * global, which is what a note typed on a phone usually means.
 *
 * The prefix matters more than it looks. SETUP_TODO offers `/remember` as the
 * way to record an ICP, and an ICP written to `global` reaches both branches —
 * a web ICP would quietly become the automation branch's ICP too. `assertWritableScopes`
 * would not catch it, because a single `global` scope is perfectly legal; only
 * the author knows the fact was branch-specific.
 */
function parseRemember(arg: string): Command {
  const match = /^(web|automation|otomasyon|genel|global)\s*:\s*(.+)$/is.exec(arg);
  if (!match) return { kind: "remember", fact: arg, scope: "global" };

  const [, label, fact] = match;
  const key = label.toLowerCase();
  const scope =
    key === "web"
      ? "branch.web"
      : key === "automation" || key === "otomasyon"
        ? "branch.automation"
        : "global";
  return { kind: "remember", fact: fact.trim(), scope };
}

export function parseCommand(input: string): Command {
  const text = input.trim();
  if (!text.startsWith("/")) return { kind: "ask", text };

  const [head, ...rest] = text.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();

  switch (head.toLowerCase()) {
    case "brief":
      return { kind: "brief" };
    case "branch": {
      const b = arg.toLowerCase();
      return { kind: "branch", branch: b.startsWith("web") ? "web" : "automation" };
    }
    case "approve":
      return { kind: "approve", id: arg };
    case "reject": {
      const [id, ...reason] = rest;
      return { kind: "reject", id: id ?? "", reason: reason.join(" ") || "Sebep belirtilmedi" };
    }
    case "pause":
      return { kind: "pause", agent: arg };
    case "run":
      return { kind: "run", agent: arg };
    case "remember":
      return parseRemember(arg);
    case "blockers":
      return { kind: "blockers" };
    default:
      return { kind: "ask", text };
  }
}

/**
 * Delivery for an approved `sending_external_messages` card.
 *
 * Approval only clears the owner's gate (§ the standing rule that nothing
 * reaches a stranger unattended) — it says nothing about whether a provider
 * is actually wired to deliver. Only "email" has one (Resend); everything
 * else lands here approved and stays manual, same as every channel did
 * before this dispatch existed, just reported rather than silent about it.
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
  const result = await sendEmail({ branch: row.branch, to: context.to, subject: context.subject, text: row.draft });

  await db.insert(activity).values({
    id: randomUUID(),
    agentId: row.agentId,
    branch: row.branch,
    department: row.agentId.split(".")[1] as (typeof agents.$inferSelect)["department"],
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

  return result.ok ? "✓ Gönderildi." : `⚠️ Gönderilemedi: ${result.reason}`;
}

export async function executeCommand(command: Command): Promise<string> {
  const db = await getDb();

  switch (command.kind) {
    case "brief": {
      return renderBrief(await buildBrief());
    }

    case "branch": {
      const brief = await buildBrief();
      const b = command.branch === "web" ? brief.web : brief.automation;
      const name = command.branch === "web" ? "Ateş Design Agency" : "Ateş Flow Agency";
      const lines = [`${name}`, `  Hat: ${b.openDeals} açık · ${fmt.money(b.pipelineValue)}`];
      if ("live" in b) {
        lines.push(`  Canlı akış: ${b.healthy} sağlıklı / ${b.erroring} hatalı`);
      } else {
        lines.push(`  Teslimat: ${b.projects} proje · ${b.atRisk} riskte`);
      }
      return lines.join("\n");
    }

    case "blockers": {
      const rows = await db.select().from(agents).where(eq(agents.status, "blocked"));
      if (rows.length === 0) return "Engellenen ajan yok.";
      return rows.map((r) => `· ${r.displayName}: ${r.blocker ?? "sebep kaydedilmemiş"}`).join("\n");
    }

    case "approve":
    case "reject": {
      const [row] = await db.select().from(approvals).where(eq(approvals.id, command.id));
      if (!row) return `Onay kaydı bulunamadı: ${command.id}`;
      if (row.state !== "pending") return `Bu kayıt zaten ${row.state}.`;
      await db
        .update(approvals)
        .set({
          state: command.kind === "approve" ? "approved" : "rejected",
          decidedAt: new Date(),
          rejectionReason: command.kind === "reject" ? command.reason : null,
        })
        .where(eq(approvals.id, command.id));
      await db.update(agents).set({ status: "idle" }).where(eq(agents.id, row.agentId));

      const verdict = `${row.title} — ${command.kind === "approve" ? "onaylandı" : "reddedildi"}.`;
      if (command.kind === "reject" || row.gate !== "sending_external_messages") return verdict;
      return `${verdict}\n${await dispatchOutreach(row)}`;
    }

    case "pause": {
      const agent = getAgent(command.agent);
      if (!agent) return unknownAgent(command.agent);
      const [row] = await db.select().from(agents).where(eq(agents.id, agent.id));
      await db.update(agents).set({ paused: !row?.paused }).where(eq(agents.id, agent.id));
      return `${agent.display_name} ${row?.paused ? "sürdürüldü" : "duraklatıldı"}.`;
    }

    case "run": {
      const agent = getAgent(command.agent);
      if (!agent) return unknownAgent(command.agent);
      const { runAgent } = await import("@/lib/agents/run");
      const result = await runAgent(agent.id, { trigger: "dispatch" });
      return `${agent.display_name} — ${result.outcome}\n${result.summary}`;
    }

    case "remember": {
      if (!command.fact) {
        return [
          "Ne hatırlamamı istiyorsun?",
          "  `/remember <bilgi>`              — her iki şube için",
          "  `/remember web: <bilgi>`         — yalnızca Ateş Design",
          "  `/remember otomasyon: <bilgi>`   — yalnızca Ateş Flow",
        ].join("\n");
      }
      const result = await writeMemory({
        kind: "preference",
        scopes: [command.scope],
        content: command.fact,
        sourceAgentId: "shared.command.chief_of_staff",
        confidence: 0.95,
        permanent: true,
      });
      const where =
        command.scope === "branch.web"
          ? " (yalnızca web şubesi)"
          : command.scope === "branch.automation"
            ? " (yalnızca otomasyon şubesi)"
            : "";
      return result.action === "merged"
        ? `Bunu zaten biliyordum — güveni artırdım${where}.`
        : `Kaydedildi, kalıcı olarak${where}.`;
    }

    case "ask": {
      // Routing to the right lead needs the model; without a key the honest
      // answer is to say so rather than fake a reply.
      if (!process.env.ANTHROPIC_API_KEY) {
        return [
          "⚠️ Serbest soru yönlendirmesi kullanılamıyor (ANTHROPIC_API_KEY tanımlı değil).",
          "Şimdilik komutlar çalışıyor: /brief /branch /blockers /approve /reject /pause /run /remember",
        ].join("\n");
      }
      const { runAgent } = await import("@/lib/agents/run");
      const result = await runAgent("shared.command.chief_of_staff", {
        trigger: "dispatch",
        task: `Sahip sordu: "${command.text}"\nDoğru lideri belirle, cevabı onun adıyla ve rakamlarla ver.`,
      });
      return result.summary;
    }
  }
}

function unknownAgent(id: string): string {
  const near = allAgents()
    .filter((a) => a.id.includes(id) || a.display_name.toLowerCase().includes(id.toLowerCase()))
    .slice(0, 5)
    .map((a) => a.id);
  return near.length
    ? `"${id}" bulunamadı. Şunlar olabilir mi?\n${near.map((n) => `  ${n}`).join("\n")}`
    : `"${id}" bulunamadı. /run <agent.id> biçiminde yaz.`;
}

export const COMMAND_HELP = `/brief            günün brifingi
/branch web|ai    tek şubenin rakamları
/blockers         engellenen ajanlar
/approve <id>     onay kartını onayla
/reject <id> <s>  gerekçesiyle reddet
/pause <agent>    ajanı duraklat / sürdür
/run <agent>      ajanı şimdi çalıştır
/remember <bilgi> kalıcı hafızaya yaz — "web:" / "otomasyon:" ile şubeye yaz`;
