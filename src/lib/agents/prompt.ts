import { readSystemPrompt, type AgentConfig } from "./registry";
import { recall } from "@/lib/brain/search";
import { copy } from "@/lib/copy";

/**
 * Assembles an agent's system prompt at run time:
 *
 *   shared behaviour rules (§3)  +  the agent's own role prompt
 *   +  top-K memories for its scopes  +  its KPIs  +  the current task
 *
 * Business facts are never baked into a prompt file. They live in the Brain and
 * are injected here, so changing a price or an ICP is a memory write rather
 * than a code change (§5).
 */

/** §3, verbatim in intent — the contract every agent operates under. */
const HOUSE_RULES = `# House rules

These override anything below that conflicts with them.

1. **Numbers first.** Open with the numbers, then what needs the owner. No preamble, no praise, no restating the question.
2. **Report reality, not vibes.** If a data source is unavailable, write \`⚠️ <source> kullanılamıyor (<reason>)\`. Never fabricate a number. Never silently skip a step. A zero is reported as a zero, with the reason it is zero.
3. **Escalate, don't stall.** If you are blocked, post one line naming the blocker and the exact thing the owner must do to unblock you.
4. **Stay in your scope.** You may only use memory from the scopes you were given. If you need something outside them, say so — do not guess at it.
5. **Approval gates are absolute.** Any action in your \`approval_required_for\` list stops and waits for the owner. Drafting is your job; sending is theirs.
6. **Self-critique before you finish.** Re-read your output against your mission, then state one thing you are genuinely unsure about, on a final line beginning \`BELİRSİZ:\`. If you are sure of everything, you have not looked hard enough.

Write for the owner in Turkish. Keep identifiers, agent ids and code in English.`;

export type PromptContext = {
  agent: AgentConfig;
  task: string;
  trigger: "schedule" | "manual" | "dispatch";
};

export type AssembledPrompt = {
  system: string;
  user: string;
  memoriesUsed: number;
};

export async function assemblePrompt(ctx: PromptContext): Promise<AssembledPrompt> {
  const { agent, task } = ctx;

  const role = readSystemPrompt(agent);

  // Retrieval query is the agent's mission plus the task: mission alone returns
  // the same context every run, task alone loses the agent's standing concerns.
  const memories = await recall({
    agent,
    query: `${agent.mission}\n${task}`,
    limit: 14,
  });

  const memoryBlock =
    memories.length === 0
      ? "(Bu kapsamda henüz anı yok.)"
      : memories
          .map(
            (m) =>
              `- [${copy.memoryKind[m.kind] ?? m.kind}${m.permanent ? " · kalıcı" : ""}] ${m.content}`,
          )
          .join("\n");

  const kpiBlock =
    agent.kpis.length === 0
      ? "(Tanımlı hedef yok.)"
      : agent.kpis.map((k) => `- ${k.label} (${k.name}): hedef ${k.target} / ${k.window}`).join("\n");

  const gateBlock =
    agent.approval_required_for.length === 0
      ? "(Onay kapısı yok — yine de dış dünyaya bir şey göndermiyorsun.)"
      : agent.approval_required_for.map((g) => `- ${g}`).join("\n");

  const escalateBlock =
    agent.escalate_to_human_when.length === 0
      ? "(Tanımlı eşik yok.)"
      : agent.escalate_to_human_when.map((e) => `- ${e}`).join("\n");

  const system = [
    HOUSE_RULES,
    "",
    "---",
    "",
    role,
    "",
    "---",
    "",
    "# Neyi biliyorsun (paylaşılan hafızadan)",
    "",
    "Bunlar kurumun hafızasından geldi. Kod içine gömülü değiller — çelişki görürsen bunu söyle.",
    "",
    memoryBlock,
    "",
    "# Hedeflerin",
    "",
    kpiBlock,
    "",
    "# Onay bekleyen aksiyonların",
    "",
    gateBlock,
    "",
    "# Sahibe taşıman gereken durumlar",
    "",
    escalateBlock,
  ].join("\n");

  const user = [
    `Tetikleyici: ${ctx.trigger}`,
    "",
    task,
    "",
    "Bitirmeden önce kendi çıktını görevine karşı bir kez oku ve son satırda `BELİRSİZ:` ile emin olmadığın tek şeyi yaz.",
  ].join("\n");

  return { system, user, memoriesUsed: memories.length };
}

/** Pulls the self-critique line out of a finished response (§3 rule 8). */
export function extractUnsure(text: string): string | null {
  const match = text.match(/BEL[İI]RS[İI]Z:\s*(.+)\s*$/im);
  return match ? match[1].trim() : null;
}
