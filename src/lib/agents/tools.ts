import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { getDb } from "@/db/client";
import { agents, approvals, leads } from "@/db/schema";
import { recall } from "@/lib/brain/search";
import { writeMemory } from "@/lib/brain/write";
import { clip, notifyOwner } from "@/lib/chat/notify";
import type { AgentConfig } from "./registry";

/**
 * The tool surface agents act through.
 *
 * The important design decision is where the approval gate lives: **inside each
 * gated tool's `run()`**. It writes an `approvals` row, flips the agent to
 * needs_approval and returns a refusal the model can reason about. That means
 * the gate cannot be bypassed by a different loop, a retry, or a future caller
 * — there is exactly one path to the outside world and it passes through here
 * (§3 rule 6).
 */

export type ToolContext = {
  agent: AgentConfig;
  activityId: string;
  /** Set when a gate tripped, so the runtime can mark the run needs_approval. */
  gated: { gate: string; title: string }[];
};

async function requireApproval(
  ctx: ToolContext,
  gate: string,
  title: string,
  draft: string,
  context: Record<string, unknown> = {},
): Promise<string> {
  const db = await getDb();
  const approvalId = randomUUID();
  await db.insert(approvals).values({
    id: approvalId,
    agentId: ctx.agent.id,
    branch: ctx.agent.branch,
    gate,
    title,
    draft,
    context,
    state: "pending",
    activityId: ctx.activityId,
    createdAt: new Date(),
  });
  await db.update(agents).set({ status: "needs_approval" }).where(eq(agents.id, ctx.agent.id));
  ctx.gated.push({ gate, title });

  // Ask, rather than wait to be checked on. Deliberately not awaited into the
  // control flow beyond this point: the card is already written, so a failed
  // ping must not fail the run.
  await notifyOwner(
    [
      `⏸ ONAY GEREKİYOR — ${ctx.agent.display_name}`,
      title,
      "",
      clip(draft),
      "",
      `/approve ${approvalId}`,
      `/reject ${approvalId} <sebep>`,
    ].join("\n"),
  );

  return [
    `DURDURULDU — bu aksiyon "${gate}" onay kapısının arkasında.`,
    `Taslak sahibin onay kutusuna düştü ve orada bekliyor. Gönderilmedi.`,
    `Devam etme; işini burada bitir ve neyi onaya gönderdiğini raporla.`,
  ].join("\n");
}

function gatedBy(agent: AgentConfig, gate: string): boolean {
  // act_freely is the owner explicitly lifting the gate for this agent.
  if (agent.autonomy === "act_freely") return false;
  return agent.approval_required_for.includes(gate);
}

/* ---------------------------------------------------------------- brain --- */

const brainRead = (ctx: ToolContext) =>
  betaZodTool({
    name: "brain_read",
    description:
      "Paylaşılan hafızada arama yapar. Yalnızca bu ajanın kapsamındaki anıları döner. İş gerçeklerini (fiyat, ICP, tercih) buradan al, tahmin etme.",
    inputSchema: z.object({
      query: z.string().describe("Aradığın şeyi doğal dille yaz."),
      limit: z.number().int().min(1).max(25).optional(),
    }),
    run: async ({ query, limit }) => {
      const rows = await recall({ agent: ctx.agent, query, limit: limit ?? 10 });
      if (rows.length === 0) return "Bu kapsamda eşleşen anı yok.";
      return rows
        .map((r) => `- [${r.kind}${r.permanent ? " · kalıcı" : ""} · güven ${r.confidence.toFixed(2)}] ${r.content}`)
        .join("\n");
    },
  });

const brainWrite = (ctx: ToolContext) =>
  betaZodTool({
    name: "brain_write",
    description:
      "Hafızaya tek bir atomik cümle yazar. Transkript yazma — özetle. Yakın kopya varsa sistem onu güçlendirir, yenisini eklemez.",
    inputSchema: z.object({
      content: z.string().max(600).describe("Tek bir bilgi, tek cümle."),
      kind: z.enum(["fact", "decision", "preference", "client_context", "lesson", "metric_snapshot"]),
      scopes: z.array(z.string()).optional().describe("Boş bırakılırsa ajanın kendi kapsamı kullanılır."),
      confidence: z.number().min(0).max(1).optional(),
    }),
    run: async ({ content, kind, scopes, confidence }) => {
      const result = await writeMemory({
        kind,
        scopes: scopes?.length ? scopes : ctx.agent.memory_scopes,
        content,
        sourceAgentId: ctx.agent.id,
        sourceActivityId: ctx.activityId,
        confidence,
      });
      if (result.action === "merged") return `Zaten biliniyordu — mevcut anı güçlendirildi (${result.into}).`;
      return `Yazıldı (${result.memory.id}).`;
    },
  });

/* -------------------------------------------------------------- browser --- */

const browser = () =>
  betaZodTool({
    name: "browser",
    description:
      "Bir URL'yi getirir ve metin içeriğini döner. Ulaşılamazsa bunu olduğu gibi bildir — bu da bir bulgudur.",
    inputSchema: z.object({ url: z.string().url() }),
    run: async ({ url }) => {
      try {
        const res = await fetch(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(12_000),
          headers: { "user-agent": "MissionControl/0.1 (+audit)" },
        });
        const html = await res.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 6000);
        return `HTTP ${res.status}\nBoyut: ${html.length} bayt\n\n${text}`;
      } catch (err) {
        return `⚠️ ${url} alınamadı (${(err as Error).message}). Bu bulgunun kendisi — site erişilemiyor.`;
      }
    },
  });

/**
 * Real Lighthouse numbers, via Google's PageSpeed Insights.
 *
 * Every failure path below returns the same ⚠️ shape the stub used to return
 * unconditionally. That is the point of this tool: a fabricated score would
 * break rule 2 in the one layer where the model cannot tell it was invented,
 * so "could not measure" must stay cheaper to say than a plausible number.
 *
 * Mobile strategy on purpose — the branch sells to local businesses whose
 * traffic is overwhelmingly phones, and mobile is where the bad scores are.
 * `GOOGLE_PAGESPEED_API_KEY` is optional; PSI serves low volume without one.
 */
const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const PSI_TIMEOUT_MS = 45_000;

const lighthouse = () =>
  betaZodTool({
    name: "lighthouse",
    description:
      "Bir sayfanın Lighthouse skorlarını ölçer (PageSpeed Insights, mobil). Ölçülemezse bunu olduğu gibi bildir.",
    inputSchema: z.object({ url: z.string().url() }),
    run: async ({ url }) => {
      const params = new URLSearchParams({ url, strategy: "mobile" });
      for (const c of ["performance", "accessibility", "best-practices", "seo"]) {
        params.append("category", c);
      }
      const key = process.env.GOOGLE_PAGESPEED_API_KEY;
      if (key) params.set("key", key);

      let payload: PsiResponse;
      try {
        const res = await fetch(`${PSI_ENDPOINT}?${params}`, {
          signal: AbortSignal.timeout(PSI_TIMEOUT_MS),
        });
        if (!res.ok) {
          const detail =
            res.status === 429
              ? "kota doldu, GOOGLE_PAGESPEED_API_KEY ekleyin"
              : `PageSpeed ${res.status}`;
          return unmeasured(url, detail);
        }
        payload = (await res.json()) as PsiResponse;
      } catch (err) {
        return unmeasured(url, (err as Error).message);
      }

      const categories = payload.lighthouseResult?.categories;
      if (!categories) {
        return unmeasured(url, "PageSpeed sonuç döndürmedi");
      }

      const pct = (score?: number | null) =>
        typeof score === "number" ? `${Math.round(score * 100)}/100` : "ölçülemedi";
      const audits = payload.lighthouseResult?.audits ?? {};
      const metric = (id: string) => audits[id]?.displayValue ?? "—";

      return [
        `Lighthouse — ${url} (PageSpeed Insights, mobil)`,
        `  Performans       ${pct(categories.performance?.score)}`,
        `  Erişilebilirlik  ${pct(categories.accessibility?.score)}`,
        `  En iyi pratikler ${pct(categories["best-practices"]?.score)}`,
        `  SEO              ${pct(categories.seo?.score)}`,
        "",
        `  LCP  ${metric("largest-contentful-paint")}`,
        `  CLS  ${metric("cumulative-layout-shift")}`,
        `  TBT  ${metric("total-blocking-time")}`,
      ].join("\n");
    },
  });

type PsiResponse = {
  lighthouseResult?: {
    categories?: Record<string, { score?: number | null } | undefined>;
    audits?: Record<string, { displayValue?: string } | undefined>;
  };
};

function unmeasured(url: string, reason: string): string {
  return `⚠️ Lighthouse kullanılamıyor (${url} ölçülemedi: ${reason}). Skor uydurma; ölçemediğini yaz ve gözle görebildiğini raporla.`;
}

/* ------------------------------------------------------------------ crm --- */

const crmRead = (ctx: ToolContext) =>
  betaZodTool({
    name: "crm_read",
    description: "Kendi şubendeki leadleri listeler.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }),
    run: async ({ limit }) => {
      const db = await getDb();
      const rows = await db
        .select()
        .from(leads)
        .where(eq(leads.branch, ctx.agent.branch === "shared" ? "web" : ctx.agent.branch))
        .limit(limit ?? 15);
      if (rows.length === 0) return "Bu şubede kayıtlı lead yok.";
      return rows
        .map((l) => `- ${l.company} (${l.city ?? "?"}, ${l.sector ?? "?"}) · uygunluk ${l.fitScore} · ${l.website ?? "site yok"}`)
        .join("\n");
    },
  });

const crmWrite = (ctx: ToolContext) =>
  betaZodTool({
    name: "crm_write",
    description: "Bir lead kaydına bulgu ekler.",
    inputSchema: z.object({
      company: z.string(),
      thesis: z.string().describe("Bir cümlelik bulgu veya tez."),
      fitScore: z.number().int().min(0).max(100).optional(),
    }),
    run: async ({ company, thesis, fitScore }) => {
      const db = await getDb();
      const [existing] = await db.select().from(leads).where(eq(leads.company, company));
      if (!existing) return `"${company}" CRM'de yok. Önce crm_read ile mevcut kayıtlara bak.`;
      await db
        .update(leads)
        .set({ thesis, fitScore: fitScore ?? existing.fitScore, sourceAgentId: ctx.agent.id })
        .where(eq(leads.id, existing.id));
      return `${company} güncellendi.`;
    },
  });

/* --------------------------------------------------------- gated tools --- */

const outreachSend = (ctx: ToolContext) =>
  betaZodTool({
    name: "outreach_send",
    description:
      "Bir mesajı gönderim kuyruğuna alır. Onay kapısı arkasındaysa gönderilmez, sahibin onayına düşer.",
    inputSchema: z.object({
      to: z.string().describe("Alıcı işletme veya adres."),
      channel: z.string(),
      body: z.string(),
    }),
    run: async ({ to, channel, body }) => {
      // Unconditional, unlike the other gates: no `gatedBy` check, so removing
      // the gate from an agent's YAML or raising it to act_freely cannot open a
      // path to a stranger's inbox. The owner's standing instruction is that
      // nothing reaches a prospect without being asked first, and a rule that
      // depends on config being right is not that rule.
      return requireApproval(ctx, "sending_external_messages", `${to} — ${channel} gönderimi`, body, {
        to,
        channel,
      });
    },
  });

const sendContract = (ctx: ToolContext) =>
  betaZodTool({
    name: "send_contract",
    description: "Sözleşme veya teklif gönderir. Her zaman onay kapısı arkasındadır.",
    inputSchema: z.object({ client: z.string(), document: z.string(), valueUsd: z.number().optional() }),
    run: async ({ client, document, valueUsd }) => {
      // Unconditional, like outreach_send — which is what the description above
      // has always claimed. Signing is manual by the owner's decision, so an
      // agent's job ends at a drafted contract sitting in the approval queue.
      return requireApproval(ctx, "sending_contracts", `${client} — sözleşme`, document, {
        client,
        valueUsd,
      });
    },
  });

const publish = (ctx: ToolContext) =>
  betaZodTool({
    name: "publish",
    description: "Müşteriye veya kamuya açık bir şey yayınlar. Onay kapısı arkasındadır.",
    inputSchema: z.object({ where: z.string(), content: z.string() }),
    run: async ({ where, content }) => {
      if (gatedBy(ctx.agent, "client_facing_publish")) {
        return requireApproval(ctx, "client_facing_publish", `${where} — yayın`, content, { where });
      }
      return `${where} üzerinde yayınlandı.`;
    },
  });

const deploy = (ctx: ToolContext) =>
  betaZodTool({
    name: "deploy",
    description: "Müşteri ortamına dağıtım yapar. Onay kapısı arkasındadır.",
    inputSchema: z.object({ target: z.string(), summary: z.string() }),
    run: async ({ target, summary }) => {
      if (gatedBy(ctx.agent, "deploying_to_client_environment")) {
        return requireApproval(ctx, "deploying_to_client_environment", `${target} — dağıtım`, summary, {
          target,
        });
      }
      return `${target} ortamına dağıtıldı.`;
    },
  });

const spend = (ctx: ToolContext) =>
  betaZodTool({
    name: "spend",
    description: "Para harcar (ücretli veri kaynağı, reklam, araç). Onay kapısı arkasındadır.",
    inputSchema: z.object({ what: z.string(), amountUsd: z.number() }),
    run: async ({ what, amountUsd }) => {
      if (gatedBy(ctx.agent, "spending_money")) {
        return requireApproval(ctx, "spending_money", `${what} — ${amountUsd} USD`, `${what}\nTutar: ${amountUsd} USD`, {
          amountUsd,
        });
      }
      return `${what} için ${amountUsd} USD harcandı.`;
    },
  });

/* ------------------------------------------------------------ assembly --- */

/**
 * The tool array is heterogeneous — every tool has a different input schema —
 * so it needs the same widened element type the SDK's own
 * `BetaToolRunnerParams.tools` uses.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = BetaRunnableTool<any>;

const BUILDERS: Record<string, (ctx: ToolContext) => AnyTool> = {
  "brain.read": brainRead,
  "brain.write": brainWrite,
  browser: () => browser(),
  lighthouse: () => lighthouse(),
  "crm.read": crmRead,
  "crm.write": crmWrite,
  "outreach.send": outreachSend,
  "docs.write": publish,
  "automation.deploy": deploy,
  "automation.build": deploy,
};

/**
 * Every agent also gets the gated tools matching its own `approval_required_for`
 * list, so an agent that is *allowed* to send has a way to try — and hits the
 * gate rather than finding no tool at all.
 */
export function toolsFor(ctx: ToolContext): AnyTool[] {
  const out = new Map<string, AnyTool>();

  for (const name of ctx.agent.tools) {
    const builder = BUILDERS[name];
    if (builder) out.set(name, builder(ctx));
  }
  for (const gate of ctx.agent.approval_required_for) {
    if (gate === "sending_contracts") out.set(gate, sendContract(ctx));
    if (gate === "client_facing_publish") out.set(gate, publish(ctx));
    if (gate === "spending_money") out.set(gate, spend(ctx));
    if (gate === "deploying_to_client_environment") out.set(gate, deploy(ctx));
    if (gate === "sending_external_messages") out.set(gate, outreachSend(ctx));
  }

  // brain.read is universal: an agent that cannot read the Brain would have to
  // invent business facts, which rule 2 forbids.
  if (!out.has("brain.read")) out.set("brain.read", brainRead(ctx));

  return [...out.values()];
}
