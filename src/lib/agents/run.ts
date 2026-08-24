import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "@/db/client";
import type { Branch } from "@/db/schema";
import { activity, agents, type Outcome } from "@/db/schema";
import { writeMemory } from "@/lib/brain/write";
import { costOf, thinkingModeFor } from "./cost";
import { narrowScopes } from "@/lib/brain/scope";
import { getSetting } from "@/lib/settings";
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
  /** The queue row this run belongs to, so `ask_owner` can park the right task. */
  taskId?: string | null;
  /**
   * Which branch the work is for. Narrows the memory scopes for this run only,
   * which is where branch isolation lives now that agents serve both branches.
   */
  branch?: Branch | null;
  /**
   * Set only by the Telegram route, and only once the message is proven to be
   * from the owner's own chat. Gates `settings_write`.
   */
  ownerChannel?: boolean;
  /**
   * Set by the daily outreach batch. Suppresses the per-card Telegram ping so
   * the batch can send one message covering the whole day; the gate itself is
   * unchanged.
   */
  batchMode?: boolean;
  /**
   * Earlier turns of this conversation, oldest first, prepended to `messages`.
   *
   * Only the Telegram chat path passes this. A worker is handed a task, not a
   * conversation — `delegate` writes the whole instruction precisely because
   * the worker cannot see any of this.
   *
   * It lands after the system prompt in the cached prefix, so the manager's
   * cache breakpoint is unaffected; the history itself is not cached and is
   * paid for in full each turn, which is what bounds it to a few turns.
   */
  history?: { role: "user" | "assistant"; content: string }[];
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
  /** Cold-call scripts this run wrote, for the batch that asked for them. */
  callScripts: { leadId: string | null; company: string; phone: string; hook: string; script: string }[];
};

const MAX_ITERATIONS = 8;

function defaultTask(): string {
  return `Görevini bir kez yürüt ve sonucunu raporla. Bugünün tarihi: ${new Date().toLocaleDateString("tr-TR")}.
Elindeki araçlarla gerçekten yapabileceğini yap; yapamadığın kısmı açıkça "yapılamadı" diye işaretle.`;
}

/**
 * Thinking and effort are not universal, and getting this wrong fails the run.
 *
 * Claude Haiku 4.5 supports extended thinking only: `thinking: {type:
 * "adaptive"}` comes back a 400, and `output_config.effort` is not among its
 * supported parameters either. Sending both unconditionally is what every agent
 * used to do, so moving a worker to Haiku broke it on every real call — and
 * stayed invisible here, because a checkout with no ANTHROPIC_API_KEY never
 * reaches the API at all.
 *
 * Extended-thinking models are sent no `thinking` block: Haiku 4.5 defaults to
 * thinking off, which is what the workers want — they run templated jobs and
 * were moved to Haiku to be cheap. If their output ever needs more deliberation,
 * the knob is `thinking: {type: "enabled", budget_tokens: N}` here, and it costs
 * tokens against the same `max_tokens`.
 */
function reasoningParams(agent: AgentConfig) {
  return thinkingModeFor(agent.model) === "adaptive"
    ? { thinking: { type: "adaptive" as const }, output_config: { effort: agent.effort } }
    : {};
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
      callScripts: [],
    };
  }

  const activityId = randomUUID();
  const startedAt = new Date();
  const trigger = options.trigger ?? "manual";
  const task = options.task ?? defaultTask();
  // The ceiling is a setting now, not an env var: the owner can raise or lower
  // it by saying so, and `AGENT_MAX_COST_USD` no longer has to be edited on the
  // box and redeployed.
  const maxCost = options.maxCostUsd ?? (await getSetting("agent.max_cost_usd"));

  // What this agent may see for *this* task, which is at most what it may ever
  // see. See `narrowScopes` — branch isolation moved from the agent to the work.
  const scopes = narrowScopes(agent.memory_scopes, options.branch);

  // Note what is deliberately absent: no `status: "working"` write. With tasks
  // running concurrently one agent can be in two runs at once, so a single
  // status column on the agent flaps and then lies. "What is running" is read
  // from the task rows instead; the agent keeps only durable states (blocked,
  // needs_approval) and `paused`.
  await db.update(agents).set({ lastRunAt: startedAt }).where(eq(agents.id, agentId));

  const ctx: ToolContext = {
    agent,
    activityId,
    gated: [],
    scopes,
    taskId: options.taskId ?? null,
    branch: options.branch ?? null,
    ownerChannel: options.ownerChannel === true,
    batchMode: options.batchMode === true,
    callScripts: [],
  };
  let outcome: Outcome = "success";
  let summary = "";
  let unsure: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let error: string | null = null;
  let memoriesWritten = 0;

  const { system, user, memoriesUsed } = await assemblePrompt({
    agent,
    task,
    trigger,
    mode: options.mode,
    scopes,
  });
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
        ...reasoningParams(agent),
        system,
        tools: toolsFor(ctx),
        messages: [...(options.history ?? []), { role: "user", content: user }],
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
      // The model's own words when it wrote any; otherwise what the tools
      // actually returned. See `toolOutcome` — throwing that away and saying
      // "no reply produced" was discarding the answer while holding it.
      summary = textOf(final).trim() || toolOutcome(runner.params.messages);
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

  /*
   * One message for both the audit row and the caller.
   *
   * These used to differ, and the gap was a silent failure with teeth: the row
   * fell back to "Çıktı üretilmedi." while the *return* kept the empty string.
   * A run that ends on a tool call with no trailing text — which is exactly
   * what happens when the model just does the thing and stops — handed "" up
   * to the Telegram route, which posted an empty message, which Telegram
   * rejects with a 400. The owner got no reply at all and nothing anywhere
   * said why.
   */
  const reported = summary.trim() || emptyRunNote(outcome, error);

  await db.insert(activity).values({
    id: activityId,
    agentId,
    branch: agent.branch,
    department: agent.department,
    action: trigger === "schedule" ? "scheduled_run" : "manual_run",
    summary: reported.slice(0, 900),
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
  if (outcome === "success" && summary.trim()) {
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
    summary: reported.slice(0, 400),
    costUsd,
    durationMs,
    simulated,
    memoriesWritten,
    gated: ctx.gated,
    callScripts: ctx.callScripts ?? [],
  };
}

/**
 * The last thing a tool reported back, for a run that called tools and then
 * wrote nothing of its own.
 *
 * This happens often and is not an error: the model calls `pause_agent`, reads
 * "Scout sürdürüldü", considers the job finished and ends the turn with no
 * prose. `max_iterations` produces the same shape — the SDK terminates the loop
 * "even if tools are still being requested", so the final message can carry
 * tool calls and no text at all.
 *
 * Either way the answer exists; it is sitting in the tool result. Reporting
 * "yazılı bir cevap üretmedim" while holding "Scout sürdürüldü" is not honesty,
 * it is discarding what we already know. The tools in this system return
 * sentences written for the owner precisely so they can be shown to him.
 *
 * The last result wins: it is the one the model was about to report on.
 */
function toolOutcome(messages: readonly Anthropic.Beta.BetaMessageParam[]): string {
  let last = "";
  for (const message of messages) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type !== "tool_result") continue;
      const body = block.content;
      const text =
        typeof body === "string"
          ? body
          : Array.isArray(body)
            ? body
                .filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === "text")
                .map((b) => b.text)
                .join("\n")
            : "";
      if (text.trim()) last = text.trim();
    }
  }
  return last;
}

/**
 * What to say when a run produced no text of its own.
 *
 * Reached only when there is genuinely nothing to report: no prose, and no tool
 * said anything either. Never empty, and never a lie — it reports what actually
 * happened rather than inventing a reply.
 */
function emptyRunNote(outcome: Outcome, error: string | null): string {
  if (error) return `Çalışma hata ile bitti: ${error}`;
  if (outcome === "needs_approval") return "Onay kartı yazıldı — telefonuna düştü ve orada bekliyor.";
  return "İşi yaptım ama yazılı bir cevap üretmedim. Ne olduğunu sorarsan bakayım.";
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
