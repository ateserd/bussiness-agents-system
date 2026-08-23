import type { BetaTextBlockParam } from "@anthropic-ai/sdk/resources/beta";
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

/**
 * Same substance as HOUSE_RULES — never fabricate, never skip a gate, escalate
 * blockers — but for a live Telegram exchange instead of a written report. The
 * report rules (numbers-first, no preamble, a mandatory closing `BELİRSİZ:`
 * line) read as a person's own text messages, that reads like a bot filing a
 * status update on every "naber".
 */
const CHAT_HOUSE_RULES = `# House rules (sohbet)

Bu bir rapor değil — sahiple canlı bir Telegram sohbeti. Aynı dürüstlük kuralları
geçerli, biçim farklı:

1. Bir insana yazar gibi yaz: kısa, doğal, \`sen\` diliyle. Başlık yok, madde
   işareti yok, rapor formatı yok — sadece soruya cevap ver.
2. Yine de sayı uydurma. Bir kaynağa erişemiyorsan bunu tek cümlede söyle, rapor
   gibi \`⚠️\` satırına gerek yok.
3. Gerçekten emin olmadığın bir şey varsa cümlenin içinde geç — ayrı bir
   \`BELİRSİZ:\` satırı bu modda zorunlu değil.
4. Soru gerçekten bir departmanın rakamını/durumunu gerektiriyorsa ilgili
   lideri adıyla an ve rakamı ver; gerektirmiyorsa yönlendirme icat etme.
5. Onay kapıların yine geçerli: bir şeyi göndermek ya da harcamak istiyorsan
   yine dur ve sor.

Write for the owner in Turkish, informal register (\`sen\`, never \`siz\`). Keep
identifiers, agent ids and code in English.`;

export type PromptContext = {
  agent: AgentConfig;
  task: string;
  trigger: "schedule" | "manual" | "dispatch";
  /** "chat" is a live conversational exchange (e.g. free-form Telegram text) —
   *  everything else is a written report and keeps the existing house rules. */
  mode?: "report" | "chat";
  /**
   * Scopes for this run, already narrowed to the task's branch. Defaults to the
   * agent's full list when the work is not branch-specific.
   */
  scopes?: string[];
};

/**
 * `system` is a block array rather than a string so a cache breakpoint can sit
 * between the stable half and the volatile one. See `assemblePrompt` for why
 * only the coordinating agent gets the breakpoint.
 */
export type AssembledPrompt = {
  system: BetaTextBlockParam[];
  user: string;
  memoriesUsed: number;
};

export async function assemblePrompt(ctx: PromptContext): Promise<AssembledPrompt> {
  const { agent, task, mode = "report" } = ctx;

  const role = readSystemPrompt(agent);

  // Retrieval query is the agent's mission plus the task: mission alone returns
  // the same context every run, task alone loses the agent's standing concerns.
  const memories = await recall({
    agent: { id: agent.id, memory_scopes: ctx.scopes ?? agent.memory_scopes },
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

  /*
   * Two halves, split by what changes between runs.
   *
   * Stable: the house rules, the role prompt, and the three blocks derived from
   * the agent's own YAML. Byte-identical from one message to the next.
   *
   * Volatile: the recalled memories and the system map. `recall()` embeds
   * `mission + task` and ranks by cosine, so the memory block moves with every
   * message — it used to sit *above* the map on the "stable" side, which broke
   * the prefix exactly where the comment claimed it was protecting it.
   */
  const stable: string[] = [
    mode === "chat" ? CHAT_HOUSE_RULES : HOUSE_RULES,
    "",
    "---",
    "",
    role,
    "",
    "---",
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
  ];

  const volatile: string[] = [
    "# Neyi biliyorsun (paylaşılan hafızadan)",
    "",
    "Bunlar kurumun hafızasından geldi. Kod içine gömülü değiller — çelişki görürsen bunu söyle.",
    "",
    memoryBlock,
  ];

  // Only the coordinating agent gets the system map.
  //
  // Wrapped, because the map is context and not capability: it reads five
  // tables to tell the manager what the system looks like, and a database
  // hiccup in any of them must not cost the owner his answer. Losing the map
  // costs the manager its picture of the system for one turn; losing the run
  // costs him the reply, the brief, or the whole Telegram exchange.
  if (agent.reports_to === null) {
    try {
      const { buildSystemMap } = await import("@/lib/system-map");
      volatile.push("", "---", "", await buildSystemMap());
    } catch (err) {
      volatile.push("", "---", "", `# Sistem haritası ⚠️ üretilemedi (${(err as Error).message})`);
    }
  }

  /*
   * The cache breakpoint, and why only the root agent gets one.
   *
   * Writing to the cache costs more than reading from it (~1.25x), so a
   * breakpoint only pays where the same prefix comes back inside the five
   * minute window. The manager runs in bursts — a Telegram message, a reply
   * thirty seconds later, another — and clears that easily. Scout runs every
   * four hours and the writer once a day: a breakpoint there would pay the
   * write premium and never read it back.
   *
   * The prefix is `tools` → `system` → `messages`, so the agent's tools count
   * toward the minimum cacheable length along with the house rules and the
   * role prompt. **That minimum is per-model**: 1024 tokens on Sonnet but
   * 4096 on Haiku 4.5, and below it the breakpoint is ignored outright — no
   * error, no write, `cache_read_input_tokens` simply stays 0. Measured on the
   * manager: ~3.3k of tools plus ~2.6k of stable text ≈ 5.9k, so ~1.8k of
   * headroom over the Haiku floor. Trimming the role prompt or dropping tools
   * eats that margin, and on Haiku the caching stops silently — re-measure
   * before doing either.
   *
   * `ctx.ownerChannel` changes the tool set, so chat and scheduled runs land
   * in two cache entries; that is expected, not a miss.
   */
  const system: BetaTextBlockParam[] =
    agent.reports_to === null
      ? [
          { type: "text", text: stable.join("\n"), cache_control: { type: "ephemeral" } },
          { type: "text", text: volatile.join("\n") },
        ]
      : [{ type: "text", text: [...stable, "", ...volatile].join("\n") }];

  const user =
    mode === "chat"
      ? task
      : [
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
