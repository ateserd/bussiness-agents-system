import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "@/db/client";
import { activity, agents, type Outcome } from "@/db/schema";
import { writeMemory } from "@/lib/brain/write";
import { costOf } from "./cost";
import { assemblePrompt, extractUnsure } from "./prompt";
import { requireAgent, type AgentConfig } from "./registry";
import { toolsFor, type ToolContext } from "./tools";

/**
 * One agent run, end to end:
 *
 *   config → assembled prompt → tool loop → activity row → memory write →
 *   status reflected on the tree
 *
 * Without ANTHROPIC_API_KEY the run happens in **simulate mode**: no model is
 * called, but every other step is real — a genuine activity row, a genuine
 * memory, a genuine status change. That keeps the loop provable on a clean
 * checkout and makes the seeded dashboard honest about what it is showing.
 */

export type RunOptions = {
  trigger?: "schedule" | "manual" | "dispatch";
  task?: string;
  /** Hard ceiling in USD; the run stops and posts a blocker if it would exceed. */
  maxCostUsd?: number;
  /** "chat" for a live conversational exchange — see prompt.ts. Defaults to "report". */
  mode?: "report" | "chat";
};

export type RunResult = {
  activityId: string;
  agentId: string;
  outcome: Outcome;
  summary: string;
  costUsd: number;
  durationMs: number;
  simulated: boolean;
  memoriesWritten: number;
  gated: { gate: string; title: string }[];
};

const MAX_ITERATIONS = 8;

function defaultTask(): string {
  return `Görevini bir kez yürüt ve sonucunu raporla. Bugünün tarihi: ${new Date().toLocaleDateString("tr-TR")}.
Elindeki araçlarla gerçekten yapabileceğini yap; yapamadığın kısmı açıkça "yapılamadı" diye işaretle.`;
}

export async function runAgent(agentId: string, options: RunOptions = {}): Promise<RunResult> {
  const agent = requireAgent(agentId);
  const db = await getDb();
  const [row] = await db.select().from(agents).where(eq(agents.id, agentId));

  if (row?.paused) {
    return {
      activityId: "",
      agentId,
      outcome: "blocked",
      summary: `${agent.display_name} duraklatılmış — çalıştırılmadı.`,
      costUsd: 0,
      durationMs: 0,
      simulated: true,
      memoriesWritten: 0,
      gated: [],
    };
  }

  const activityId = randomUUID();
  const startedAt = new Date();
  const trigger = options.trigger ?? "manual";
  const task = options.task ?? defaultTask();
  const maxCost = options.maxCostUsd ?? Number(process.env.AGENT_MAX_COST_USD ?? "0.5");

  await db.update(agents).set({ status: "working", lastRunAt: startedAt }).where(eq(agents.id, agentId));

  const ctx: ToolContext = { agent, activityId, gated: [] };
  let outcome: Outcome = "success";
  let summary = "";
  let unsure: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let error: string | null = null;
  let memoriesWritten = 0;

  const { system, user, memoriesUsed } = await assemblePrompt({ agent, task, trigger, mode: options.mode });
  const simulated = !process.env.ANTHROPIC_API_KEY;

  try {
    if (simulated) {
      const sim = simulate(agent, memoriesUsed);
      summary = sim.summary;
      unsure = sim.unsure;
      inputTokens = sim.inputTokens;
      outputTokens = sim.outputTokens;
    } else {
      const client = new Anthropic();
      const runner = client.beta.messages.toolRunner({
        model: agent.model,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: { effort: agent.effort },
        system,
        tools: toolsFor(ctx),
        messages: [{ role: "user", content: user }],
        max_iterations: MAX_ITERATIONS,
      });

      for await (const message of runner) {
        inputTokens += message.usage?.input_tokens ?? 0;
        outputTokens += message.usage?.output_tokens ?? 0;

        // The runner does not auto-resume a paused turn; without this the loop
        // ends early and silently returns a truncated answer.
        if (message.stop_reason === "pause_turn") {
          runner.pushMessages({ role: "assistant", content: message.content });
          continue;
        }
        if (message.stop_reason === "refusal") {
          outcome = "failure";
          error = "Model isteği reddetti.";
          break;
        }
        if (costOf(agent.model, inputTokens, outputTokens) > maxCost) {
          outcome = "blocked";
          error = `Maliyet tavanı aşıldı (${maxCost} USD). Çalışma durduruldu.`;
          break;
        }
      }

      const final = await runner.done();
      summary = textOf(final).trim();
      unsure = extractUnsure(summary);
    }

    if (ctx.gated.length > 0) outcome = "needs_approval";
  } catch (err) {
    outcome = "failure";
    error = (err as Error).message;
    summary = `Çalışma hata ile bitti: ${error}`;
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const costUsd = costOf(agent.model, inputTokens, outputTokens);

  await db.insert(activity).values({
    id: activityId,
    agentId,
    branch: agent.branch,
    department: agent.department,
    action: trigger === "schedule" ? "scheduled_run" : "manual_run",
    summary: summary.slice(0, 900) || "Çıktı üretilmedi.",
    reason:
      trigger === "manual" ? "Sahip panelden çalıştırdı." : "Programlı çalışma.",
    input: { task, memoriesUsed, trigger },
    output: { text: summary.slice(0, 4000) },
    unsureAbout: unsure,
    outcome,
    costUsd: costUsd.toFixed(6),
    inputTokens,
    outputTokens,
    durationMs,
    simulated,
    error,
    startedAt,
    finishedAt,
  });

  // A run that produced something worth keeping writes it to the Brain. In
  // simulate mode this is what proves the write path end to end.
  if (outcome === "success" && summary) {
    try {
      const statement = firstStatement(summary);
      if (statement) {
        await writeMemory({
          kind: "lesson",
          scopes: agent.memory_scopes,
          content: statement,
          sourceAgentId: agentId,
          sourceActivityId: activityId,
          confidence: 0.55,
        });
        memoriesWritten = 1;
      }
    } catch {
      // A memory that will not write must never fail the run that produced it.
    }
  }

  await db
    .update(agents)
    .set({
      status: outcome === "needs_approval" ? "needs_approval" : outcome === "blocked" ? "blocked" : "idle",
      blocker: outcome === "blocked" ? error : null,
      lastRunAt: finishedAt,
    })
    .where(eq(agents.id, agentId));

  return {
    activityId,
    agentId,
    outcome,
    summary: summary.slice(0, 400),
    costUsd,
    durationMs,
    simulated,
    memoriesWritten,
    gated: ctx.gated,
  };
}

function textOf(message: { content: unknown }): string {
  const blocks = message.content as { type: string; text?: string }[] | undefined;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

/** First sentence that reads like a durable statement, for the memory write. */
function firstStatement(text: string): string | null {
  const cleaned = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !/^BEL[İI]RS[İI]Z:/i.test(l))
    .join(" ");
  const sentence = cleaned.split(/(?<=[.!?])\s+/)[0];
  if (!sentence || sentence.length < 20) return null;
  return sentence.slice(0, 400);
}

/**
 * Simulate mode. Deterministic per agent so the same click gives the same
 * result, and clearly labelled everywhere it surfaces.
 */
function simulate(agent: AgentConfig, memoriesUsed: number) {
  const gate = agent.approval_required_for[0];
  const lines = [
    `${agent.display_name} simüle çalışma tamamlandı.`,
    `Hafızadan ${memoriesUsed} anı okundu, ${agent.tools.length} araç bağlıydı.`,
    gate
      ? `Bu ajanın "${gate}" onay kapısı var — gerçek çalışmada dış aksiyon burada dururdu.`
      : `Bu ajanın onay kapısı yok; çıktısı yine de dışarı çıkmadan liderine gider.`,
    `Model çağrılmadı: ANTHROPIC_API_KEY tanımlı değil.`,
  ];
  return {
    summary: lines.join(" "),
    unsure: "Bu bir simülasyon; gerçek çalışmanın çıktısı farklı olacaktır.",
    inputTokens: 0,
    outputTokens: 0,
  };
}
