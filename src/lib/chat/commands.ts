import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { agents } from "@/db/schema";
import { allAgents, getAgent, rootAgent } from "@/lib/agents/registry";
import { buildBrief, renderBrief } from "@/lib/brief";
import { writeMemory } from "@/lib/brain/write";
import { settleApproval } from "@/lib/approvals";
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
  | { kind: "answer"; id: string; text: string }
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

/** Split an argument string into words, dropping the empties. */
function rest2(arg: string): string[] {
  return arg.split(/\s+/).filter(Boolean);
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
    case "cevap":
    case "answer": {
      // `/cevap <id> <metin>` and, when only one question is open, `/cevap <metin>`.
      const [maybeId, ...rest] = rest2(arg);
      const looksLikeId = /^[0-9a-f]{6}$/i.test(maybeId ?? "");
      return looksLikeId
        ? { kind: "answer", id: maybeId, text: rest.join(" ") }
        : { kind: "answer", id: "", text: arg };
    }
    default:
      return { kind: "ask", text };
  }
}

/**
 * `ownerChannel` is proof the message came from the owner's own verified
 * Telegram chat — not from a webhook, a schedule, or text an agent read
 * somewhere. Only that path may reach the settings table.
 */
export type ExecuteOptions = { ownerChannel?: boolean };

export async function executeCommand(command: Command, options: ExecuteOptions = {}): Promise<string> {
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

    case "answer": {
      const { resolveAnswerTarget, answerTask, shortId } = await import("@/lib/tasks");
      if (!command.text.trim()) return "Cevap boş. `/cevap <metin>` ya da `/cevap <id> <metin>`.";
      const target = await resolveAnswerTarget(command.id || undefined);
      if (target.kind === "none") return "Cevap bekleyen bir görev yok.";
      if (target.kind === "many") {
        return [
          "Birden fazla açık soru var — hangisi?",
          ...target.tasks.map((t) => `  /cevap ${shortId(t.id)} …  → ${t.question}`),
        ].join("\n");
      }
      await answerTask(target.task.id, command.text.trim());
      return `#${shortId(target.task.id)} cevaplandı — görev kaldığı yerden devam edecek.`;
    }

    case "blockers": {
      const rows = await db.select().from(agents).where(eq(agents.status, "blocked"));
      if (rows.length === 0) return "Engellenen ajan yok.";
      return rows.map((r) => `· ${r.displayName}: ${r.blocker ?? "sebep kaydedilmemiş"}`).join("\n");
    }

    case "approve":
    case "reject": {
      const settled = await settleApproval(
        command.id,
        command.kind === "approve" ? "approved" : "rejected",
        command.kind === "reject" ? command.reason : undefined,
        "chat",
      );
      return settled.message;
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
        sourceAgentId: rootAgent().id,
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
      const result = await runAgent(rootAgent().id, {
        trigger: "dispatch",
        mode: "chat",
        ownerChannel: options.ownerChannel === true,
        task: `Sahip Telegram'dan yazdı: "${command.text}"\n\nBu bir sohbet mesajı, rapor değil — doğrudan ve doğal cevap ver. Soru gerçekten bir departmanın durumunu/rakamını gerektiriyorsa ilgili lideri adıyla an; gerektirmiyorsa yönlendirme icat etme, sadece cevapla.`,
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

export const COMMAND_HELP = `Komut ezberlemene gerek yok — ne istediğini normal yaz, Yönetici anlar.
Kısayollar:

/brief            günün brifingi
/branch web|ai    tek şubenin rakamları
/cevap <metin>    sana takılı soruyu cevapla (tek soru varsa id gerekmez)
/blockers         engellenen ajanlar
/approve <id>     onay kartını onayla
/reject <id> <s>  gerekçesiyle reddet
/pause <agent>    ajanı duraklat / sürdür
/run <agent>      ajanı şimdi çalıştır
/remember <bilgi> kalıcı hafızaya yaz — "web:" / "otomasyon:" ile şubeye yaz`;
