import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { BetaToolUnion } from "@anthropic-ai/sdk/resources/beta";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { getDb } from "@/db/client";
import type { Branch } from "@/db/schema";
import { agents, approvals, leads } from "@/db/schema";
import { recall } from "@/lib/brain/search";
import { writeMemory } from "@/lib/brain/write";
import { clip, notifyOwner } from "@/lib/chat/notify";
import { passesAutomationFloor, qualifiesForWeb, searchPlaces } from "@/lib/integrations/places";
import { allAgents, getAgent, type AgentConfig } from "./registry";
import { isToolName, type ToolName } from "./tool-names";

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
  /**
   * Cold-call scripts written during this run, collected the same way `gated`
   * is. A call needs no approval — the owner makes it himself — so there is no
   * approval row to hang the text on, and the batch that started the run wants
   * the scripts back to put in its message.
   */
  callScripts?: { leadId: string | null; company: string; phone: string; hook: string; script: string }[];
  /**
   * Memory scopes for *this run*, already narrowed to the task's branch. Read
   * these rather than `agent.memory_scopes`: the agent's own list is the
   * maximum it may ever see, this is what it may see right now.
   */
  scopes: string[];
  /** The queue row this run belongs to, so `ask_owner` can park the right task. */
  taskId?: string | null;
  /** Which branch the work is for, when it is branch-specific. */
  branch?: Branch | null;
  /**
   * True only when this run was started by a message on the owner's own
   * verified Telegram chat. `settings_write` is mounted only then — inbound
   * cold-mail replies land in the Brain and agents read the Brain, so a
   * prospect can get text in front of an agent. That text must never be able
   * to reach the settings table.
   */
  ownerChannel?: boolean;
  /**
   * True while the daily batch is assembling the day's drafts. It suppresses
   * the per-card Telegram ping so the batch can send one message instead of
   * ten; nothing else about the gate changes.
   */
  batchMode?: boolean;
};

async function requireApproval(
  ctx: ToolContext,
  gate: string,
  title: string,
  draft: string,
  context: Record<string, unknown> = {},
  /**
   * Set false only by the daily batch, which renders one message for the whole
   * day instead of one per card. It changes how the owner is *asked*, never
   * whether he is: every item here is still pending, and still only leaves
   * through `settleApproval`.
   */
  notify = true,
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
  //
  // The daily outreach batch suppresses this and sends one message covering
  // every card it just wrote — ten drafts should not be ten notifications. The
  // gate is unchanged; only its granularity is.
  if (notify) {
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
  }

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
      const rows = await recall({
        agent: { id: ctx.agent.id, memory_scopes: ctx.scopes },
        query,
        limit: limit ?? 10,
      });
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
        scopes: scopes?.length ? scopes : ctx.scopes,
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

/**
 * Lead discovery. Costs money per search, so it sits behind the same
 * `spending_money` gate the Prospectors already carry.
 *
 * The ICP filters run here rather than in the model: whether a business has a
 * website and how many reviews it has are facts the API returns, and a model
 * asked to "remember to filter" eventually forgets. What comes back is already
 * qualified, with the rejected count stated so a thin list is visibly thin
 * rather than quietly short.
 */
const placesSearch = (ctx: ToolContext) =>
  betaZodTool({
    name: "places_search",
    description:
      "Google Haritalar'dan işletme arar ve ICP filtresini uygular. Ücretli — her arama para harcar.",
    inputSchema: z.object({
      query: z.string().describe("Örn: \"Antalya'da balık restoranı\""),
      maxResults: z.number().int().min(1).max(20).optional(),
    }),
    run: async ({ query, maxResults }) => {
      if (gatedBy(ctx.agent, "spending_money")) {
        return requireApproval(
          ctx,
          "spending_money",
          `Places araması — "${query}"`,
          `Google Places API'de "${query}" araması yapılacak (en fazla ${maxResults ?? 20} sonuç).`,
          { query },
        );
      }

      const result = await searchPlaces({ query, maxResults });
      if (!result.ok) {
        return `⚠️ Google Places kullanılamıyor (${result.reason}). Liste uydurma; kaynağın çalışmadığını yaz.`;
      }

      const web = ctx.agent.branch === "web";
      const qualified = result.places.filter(web ? qualifiesForWeb : passesAutomationFloor);
      const rejected = result.places.length - qualified.length;

      if (qualified.length === 0) {
        return `"${query}": ${result.places.length} sonuç geldi, hiçbiri ICP'yi geçmedi (${rejected} elendi). Bu da bir bulgu — sorguyu daralt ya da başka bir şehir dene.`;
      }

      const rows = qualified.map(
        (p) =>
          `- ${p.name} · ${p.category ?? "?"} · ${p.phone ?? "telefon yok"} · ${p.reviewCount} yorum${p.rating ? ` (${p.rating})` : ""} · ${p.website ? `site: ${p.website}` : "site yok"} · ${p.address ?? "?"} · place:${p.placeId}`,
      );
      return [
        `"${query}" — ${qualified.length} aday ICP'yi geçti, ${rejected} elendi.`,
        ...rows,
        "",
        web
          ? "Eleme: sitesi olan ve hiç yorumu olmayan işletmeler çıkarıldı."
          : "Eleme: hiç yorumu olmayan işletmeler çıkarıldı. n8n bağlanabilirliğini Dossier kanıtla doğrulayacak.",
      ].join("\n");
    },
  });

/* --------------------------------------------------------- gated tools --- */

const outreachSend = (ctx: ToolContext) =>
  betaZodTool({
    name: "outreach_send",
    description:
      "Bir mesajı gönderim kuyruğuna alır. Onay kapısı arkasındaysa gönderilmez, sahibin onayına düşer. " +
      "channel \"email\" ise onaydan sonra gerçekten gönderilir, bu yüzden subject zorunlu; başka kanallarda " +
      "kısa bir etiket olarak kullanılabilir.",
    inputSchema: z.object({
      to: z.string().describe("Alıcı işletme veya adres."),
      channel: z.string(),
      subject: z.string().describe("E-posta konusu (email dışı kanallarda kısa bir etiket)."),
      body: z.string(),
      leadId: z.string().optional().describe("Bu mesaj bir lead'e gidiyorsa onun id'si — listede verildi."),
      company: z.string().optional().describe("İşletme adı, sahibin listede göreceği isim."),
    }),
    run: async ({ to, channel, subject, body, leadId, company }) => {
      // Unconditional, unlike the other gates: no `gatedBy` check, so removing
      // the gate from an agent's YAML or raising it to act_freely cannot open a
      // path to a stranger's inbox. The owner's standing instruction is that
      // nothing reaches a prospect without being asked first, and a rule that
      // depends on config being right is not that rule.
      return requireApproval(
        ctx,
        "sending_external_messages",
        `${company ?? to} — ${channel} gönderimi`,
        body,
        { to, channel, subject, leadId, company },
        !ctx.batchMode,
      );
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

/* --------------------------------------------------------- coordination --- */

/**
 * The delegation tool that `agent.dispatch` claimed to be for the whole life of
 * v1 while being absent from `BUILDERS` — declared in eleven YAML files, silently
 * dropped by `toolsFor`, so the Chief of Staff could never actually hand work to
 * anyone. This is the real one.
 *
 * Fire-and-forget on purpose. A manager that blocked inside its own run waiting
 * for a worker would burn tokens holding a conversation open and could hit
 * `MAX_ITERATIONS` before the worker finished. Instead the task is queued, the
 * manager says so, and the worker reports when it is done.
 */
const delegate = (ctx: ToolContext) =>
  betaZodTool({
    name: "delegate",
    description:
      "Bir işi başka bir ajana verir ve hemen döner — beklemez. Görev kuyruğa girer, " +
      "sonucu bittiğinde bildirilir. Kendine görev veremezsin.",
    inputSchema: z.object({
      agent: z.string().describe("Ajan id'si, örn. shared.outreach.scout"),
      title: z.string().describe("Kısa başlık, sahibin panelde göreceği metin."),
      instruction: z.string().describe("Ajana ne yapacağını anlatan tam talimat."),
      branch: z
        .enum(["web", "automation"])
        .optional()
        .describe("İş bir şubeye aitse yaz — hafıza kapsamı buna göre daraltılır."),
    }),
    run: async ({ agent, title, instruction, branch }) => {
      if (agent === ctx.agent.id) return "Kendine görev veremezsin.";
      const target = getAgent(agent);
      if (!target) {
        return `"${agent}" diye bir ajan yok. Mevcutlar: ${allAgents().map((a) => a.id).join(", ")}`;
      }
      const { createTask, shortId } = await import("@/lib/tasks");
      const row = await createTask({
        agentId: target.id,
        title,
        instruction,
        branch: branch ?? null,
        parentTaskId: ctx.taskId ?? null,
        source: "manager",
      });
      return `Görev kuyruğa alındı: #${shortId(row.id)} — ${target.display_name}. Beklemiyorum, bittiğinde haber verilecek.`;
    },
  });

/**
 * Ask the owner and stop — without stopping anything else.
 *
 * This parks *this* task only. The queue keeps running the others, which is the
 * whole point: "emin olamadığın noktalarda o görevini bekletip diğer görevleri
 * de aynı anda yapabilmeli". The return string is deliberately a hard stop, the
 * same shape `requireApproval` uses, so the model finishes its turn instead of
 * inventing an answer to its own question.
 */
const askOwner = (ctx: ToolContext) =>
  betaZodTool({
    name: "ask_owner",
    description:
      "Emin olmadığın bir şeyi sahibe sorar ve bu görevi beklemeye alır. " +
      "Diğer görevler etkilenmez. Tahmin etmek yerine bunu kullan.",
    inputSchema: z.object({
      question: z.string().describe("Tek cümlelik, karar boyutunda bir soru."),
    }),
    run: async ({ question }) => {
      const { parkTask, shortId } = await import("@/lib/tasks");
      if (ctx.taskId) {
        await parkTask(ctx.taskId, question);
        await notifyOwner(`❓ ${ctx.agent.display_name} soruyor (#${shortId(ctx.taskId)})\n\n${clip(question, 600)}`);
        return (
          `SORULDU — bu görev beklemeye alındı (#${shortId(ctx.taskId)}).\n` +
          "Cevap gelince kaldığın yerden devam edeceksin. Şimdi durur ve neyi sorduğunu raporlarsın; tahmin etme."
        );
      }
      await notifyOwner(`❓ ${ctx.agent.display_name} soruyor\n\n${clip(question, 600)}`);
      return "SORULDU — sahibe iletildi. Şimdi dur ve neyi sorduğunu raporla; tahmin etme.";
    },
  });

/* -------------------------------------------------------------- settings --- */

const settingsRead = () =>
  betaZodTool({
    name: "settings_read",
    description: "Sistemdeki tüm ayarları ve güncel değerlerini listeler.",
    inputSchema: z.object({}),
    run: async () => {
      const { allSettings } = await import("@/lib/settings");
      const rows = await allSettings();
      return rows
        .map((r) => `- ${r.key} = ${r.value}${r.isDefault ? " (varsayılan)" : ""} — ${r.def.label}`)
        .join("\n");
    },
  });

const settingsWrite = (ctx: ToolContext) =>
  betaZodTool({
    name: "settings_write",
    description:
      "Bir ayarı değiştirir. Yalnızca sahip Telegram'dan istediğinde kullan. " +
      "Geçersiz değer reddedilir; değişiklik sahibe bildirilir.",
    inputSchema: z.object({
      key: z.string().describe("Ayar anahtarı, settings_read çıktısındaki gibi."),
      value: z.string().describe("Yeni değer, metin olarak."),
    }),
    run: async ({ key, value }) => {
      const { setSetting, isSettingKey, needsOwnerConfirm } = await import("@/lib/settings");
      if (isSettingKey(key) && needsOwnerConfirm(key)) {
        // These weaken a guarantee rather than tune a number, so one sentence
        // is not enough — the owner has to say yes to this specific change.
        return (
          `"${key}" bir güvenlik ayarı. Sahibe tam olarak neyi neyle değiştireceğini söyle ` +
          "ve açık onayını al; onaylarsa tekrar çağır."
        );
      }
      const result = await setSetting(key, value, ctx.ownerChannel ? "owner" : ctx.agent.id);
      if (!result.ok) return `⚠️ ${result.reason}`;
      await notifyOwner(`⚙️ ${result.label}: ${result.from} → ${result.to}`);
      return `${result.label} ${result.from} → ${result.to} olarak güncellendi.`;
    },
  });

/**
 * Route the owner's reply back to the task that asked.
 *
 * The manager can see the open questions in its system map, so it resolves
 * which one a free-form reply belongs to. It must not guess between two: with
 * more than one open and no id, this refuses and says so, because an answer
 * silently attached to the wrong task is acted on as if it were right.
 */
const answerTaskTool = () =>
  betaZodTool({
    name: "answer_task",
    description:
      "Sahibin cevabını, o cevabı bekleyen göreve iletir ve görevi kaldığı yerden devam ettirir. " +
      "Birden fazla açık soru varsa taskId zorunlu.",
    inputSchema: z.object({
      answer: z.string().describe("Sahibin verdiği cevap, olduğu gibi."),
      taskId: z
        .string()
        .optional()
        .describe("Kısa görev id'si (#a4f2c1 içindeki a4f2c1). Tek açık soru varsa gerekmez."),
    }),
    run: async ({ answer, taskId }) => {
      const { resolveAnswerTarget, answerTask, shortId } = await import("@/lib/tasks");
      const target = await resolveAnswerTarget(taskId);
      if (target.kind === "none") return "Cevap bekleyen bir görev yok.";
      if (target.kind === "many") {
        return (
          "Birden fazla açık soru var, hangisini cevapladığını bilmeden ilerleyemem:\n" +
          target.tasks.map((t) => `#${shortId(t.id)} — ${t.question}`).join("\n") +
          "\nSahibe hangisi olduğunu sor."
        );
      }
      const resumed = await answerTask(target.task.id, answer);
      if (!resumed) return "Görev artık cevap bekler durumda değil.";
      return `#${shortId(target.task.id)} cevaplandı, görev kuyruğa geri alındı.`;
    },
  });

/* -------------------------------------------------------------- calendar --- */

/**
 * What an approved calendar card will actually do, stored on the approval row
 * so the settle path can execute it without re-deriving anything.
 */
export type CalendarOp =
  | {
      op: "create";
      title: string;
      startsAt: string;
      durationMin: number;
      attendees: string[];
      description?: string;
      withMeet: boolean;
    }
  | {
      op: "update";
      eventId: string;
      label: string;
      title?: string;
      startsAt?: string;
      durationMin?: number;
      attendees?: string[];
    }
  | { op: "cancel"; eventId: string; label: string };

/**
 * Reading the calendar is not gated. Nothing leaves the building and nothing
 * changes; an agent that could not see the week would have to ask the owner
 * what his own diary says.
 */
const calendarRead = () =>
  betaZodTool({
    name: "calendar_read",
    description:
      "Sahibin takvimindeki yaklaşan toplantıları listeler (Meet linkleri ve etkinlik id'leriyle). " +
      "Bir toplantıyı değiştirmeden ya da iptal etmeden önce id'sini buradan al.",
    inputSchema: z.object({
      days: z.number().int().min(1).max(60).optional().describe("Kaç günlük ileriye bakılacak (varsayılan 7)."),
    }),
    run: async ({ days }) => {
      const { listUpcoming, describe } = await import("@/lib/integrations/google-calendar");
      const res = await listUpcoming(days ?? 7);
      if (!res.ok) return `⚠️ Takvim kullanılamıyor (${res.reason}). Toplantı uydurma; okuyamadığını yaz.`;
      if (res.meetings.length === 0) return `Önümüzdeki ${days ?? 7} günde kayıtlı toplantı yok.`;
      return res.meetings.map((m) => `- ${describe(m)}`).join("\n");
    },
  });

/**
 * The three calendar mutations, all behind one unconditional gate.
 *
 * Unconditional in the same sense as `outreach_send`: no `gatedBy` check, so no
 * YAML edit and no `act_freely` can open a path around it. The owner's
 * instruction was explicit — "toplantı ayarlama ve iptali için tam yetkisi
 * olsun ama telegramdan bana sormadan yapmasın silme ekleme değiştirme falan" —
 * which is authority over the whole calendar paired with a mandatory ask, and a
 * gate that config could remove would not be that.
 *
 * Nothing here touches Google. The card is written, the owner answers on his
 * phone, and `settleApproval` does the work — so the ask cannot be skipped by
 * reaching for a different code path.
 */
function calendarGate(ctx: ToolContext, title: string, draft: string, op: CalendarOp): Promise<string> {
  return requireApproval(ctx, "changing_calendar", title, draft, { calendar: op });
}

const meetingSchedule = (ctx: ToolContext) =>
  betaZodTool({
    name: "meeting_schedule",
    description:
      "Yeni bir toplantı önerir: Google Meet linki üretilir, takvime eklenir ve katılımcılara davet " +
      "gider. Sahibin onayı olmadan hiçbir şey oluşturulmaz — bu araç yalnızca onay kartı yazar.",
    inputSchema: z.object({
      title: z.string().describe("Toplantı başlığı, sahibin takviminde göreceği metin."),
      startsAt: z
        .string()
        .describe("Başlangıç: 2026-08-25T14:00 biçiminde, sahibin yerel saatiyle. Tahmin etme, sor."),
      durationMin: z.number().int().min(15).max(480).optional(),
      attendeeEmails: z.array(z.string().email()).default([]).describe("Davet edilecek e-posta adresleri."),
      description: z.string().optional().describe("Toplantı notu / gündem."),
      withMeet: z.boolean().optional().describe("Meet linki üretilsin mi (varsayılan evet)."),
    }),
    run: async ({ title, startsAt, durationMin, attendeeEmails, description, withMeet }) => {
      const { getSetting } = await import("@/lib/settings");
      const minutes = durationMin ?? (await getSetting("meeting.default_duration_min"));
      const meet = withMeet !== false;
      const draft = [
        `Başlık: ${title}`,
        `Zaman: ${startsAt} · ${minutes} dk`,
        `Katılımcı: ${attendeeEmails.length > 0 ? attendeeEmails.join(", ") : "yok (yalnızca sen)"}`,
        `Meet linki: ${meet ? "üretilecek" : "üretilmeyecek"}`,
        description ? `Not: ${description}` : "",
        "",
        "Onaylarsan takvime eklenir ve davet katılımcılara Google tarafından gönderilir.",
      ]
        .filter(Boolean)
        .join("\n");
      return calendarGate(ctx, `Toplantı — ${title}`, draft, {
        op: "create",
        title,
        startsAt,
        durationMin: minutes,
        attendees: attendeeEmails,
        description,
        withMeet: meet,
      });
    },
  });

const meetingUpdate = (ctx: ToolContext) =>
  betaZodTool({
    name: "meeting_update",
    description:
      "Var olan bir toplantıyı değiştirir (saat, başlık, katılımcı). eventId'yi calendar_read'den al. " +
      "Sahibin onayı olmadan hiçbir şey değişmez.",
    inputSchema: z.object({
      eventId: z.string().describe("calendar_read çıktısındaki id:... değeri."),
      label: z.string().describe("Toplantının şu anki adı — sahip kartta neyi değiştirdiğini görsün."),
      title: z.string().optional(),
      startsAt: z.string().optional().describe("Yeni başlangıç, 2026-08-25T14:00 biçiminde."),
      durationMin: z.number().int().min(15).max(480).optional(),
      attendeeEmails: z.array(z.string().email()).optional(),
    }),
    run: async ({ eventId, label, title, startsAt, durationMin, attendeeEmails }) => {
      const changes = [
        title ? `Başlık → ${title}` : "",
        startsAt ? `Zaman → ${startsAt}${durationMin ? ` · ${durationMin} dk` : ""}` : "",
        attendeeEmails ? `Katılımcı → ${attendeeEmails.join(", ") || "yok"}` : "",
      ].filter(Boolean);
      if (changes.length === 0) return "Değiştirilecek bir alan vermedin.";
      const draft = [`Toplantı: ${label}`, ...changes, "", "Onaylarsan katılımcılara güncelleme gider."].join("\n");
      return calendarGate(ctx, `Toplantı değişikliği — ${label}`, draft, {
        op: "update",
        eventId,
        label,
        title,
        startsAt,
        durationMin,
        attendees: attendeeEmails,
      });
    },
  });

const meetingCancel = (ctx: ToolContext) =>
  betaZodTool({
    name: "meeting_cancel",
    description:
      "Bir toplantıyı iptal eder. eventId'yi calendar_read'den al. Sahibin onayı olmadan iptal edilmez.",
    inputSchema: z.object({
      eventId: z.string().describe("calendar_read çıktısındaki id:... değeri."),
      label: z.string().describe("Toplantının adı ve saati — sahip neyi iptal ettiğini görsün."),
      reason: z.string().optional().describe("İptal gerekçesi, varsa."),
    }),
    run: async ({ eventId, label, reason }) => {
      const draft = [
        `İptal edilecek: ${label}`,
        reason ? `Gerekçe: ${reason}` : "",
        "",
        "Onaylarsan takvimden silinir ve katılımcılara iptal bildirimi gider. Bu geri alınamaz.",
      ]
        .filter(Boolean)
        .join("\n");
      return calendarGate(ctx, `Toplantı iptali — ${label}`, draft, { op: "cancel", eventId, label });
    },
  });

/* ------------------------------------------------------------------ para --- */

/**
 * TL ↔ USD at a rate that was actually fetched.
 *
 * Every money column in the schema is USD and the business runs in lira, so
 * without this an agent asked to record "45 bin TL" either invents a rate or
 * writes the wrong number into the ledger. The rate's date travels with the
 * answer because a Friday rate quoted on a Sunday is correct but must not read
 * as today's.
 */
const money = () =>
  betaZodTool({
    name: "money",
    description:
      "Lira ile dolar arasında güncel kurdan çevirir. Kuru asla kendin tahmin etme — tutarı yazmadan " +
      "önce buradan çevir. Kaynak ulaşılamazsa çevirme, ulaşılamadığını yaz.",
    inputSchema: z.object({
      amount: z.number().describe("Çevrilecek tutar."),
      from: z.enum(["TRY", "USD"]).describe("Tutarın para birimi."),
    }),
    run: async ({ amount, from }) => {
      const { tryToUsd, usdToTry, rateNote } = await import("@/lib/integrations/fx");
      if (from === "TRY") {
        const res = await tryToUsd(amount);
        if (!res.ok) return `⚠️ Kur kaynağı kullanılamıyor (${res.reason}). Tutarı çevirme, TL olarak bırak ve bunu yaz.`;
        return `${amount.toLocaleString("tr-TR")} TL = ${res.usd.toFixed(2)} USD · ${rateNote(res.usdTry, res.asOf, res.source)}`;
      }
      const res = await usdToTry(amount);
      if (!res.ok) return `⚠️ Kur kaynağı kullanılamıyor (${res.reason}). Tutarı çevirme, USD olarak bırak ve bunu yaz.`;
      return `${amount.toFixed(2)} USD = ${res.tryAmount.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} TL · ${rateNote(res.usdTry, res.asOf, res.source)}`;
    },
  });

/* ------------------------------------------------------------- araştırma --- */

/**
 * Search and fetch, executed on Anthropic's side rather than here.
 *
 * The local `browser` tool stays: it fetches one URL the agent already knows
 * about. These answer the other half — "bu sektörde iyi siteler hangileri" —
 * which needs a search index, and returning real names and links instead of
 * adjectives was the explicit ask.
 *
 * `code_execution` must never be declared alongside these: the server-side
 * tools run their own sandbox, and declaring both puts two sandboxes in one
 * request.
 */
const webSearch = (): AnyTool => ({ type: "web_search_20260209", name: "web_search", max_uses: 6 });
const webFetch = (): AnyTool => ({ type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 });

/* -------------------------------------------------------------- outreach --- */

/**
 * A cold-call script, which is the web branch's entire outreach.
 *
 * `qualifiesForWeb` means no website, and a business with no website has no
 * discoverable email — so for that branch "mail varsa mail, yoksa arama" is not
 * a fallback, it is the path. These need no approval: the owner dials the phone
 * himself, so there is no gate to pass and nothing to settle. The script is
 * collected on the context and handed back to the batch that asked for it.
 */
const callScript = (ctx: ToolContext) =>
  betaZodTool({
    name: "call_script",
    description:
      "Sitesi olmayan (yani maille ulaşılamayan) bir lead için arama metni yazar. Onay gerekmez — " +
      "sahip kendisi arıyor. Listede verilen her arama lead'i için bir kez çağır.",
    inputSchema: z.object({
      leadId: z.string().describe("Lead id'si, listede verildi."),
      company: z.string(),
      phone: z.string(),
      hook: z.string().describe("Tek cümlelik açılış — sahip listede bunu görecek."),
      script: z.string().describe("Tam arama metni: açılış, iki soru, kapanış."),
    }),
    run: async ({ leadId, company, phone, hook, script }) => {
      if (!ctx.callScripts) ctx.callScripts = [];
      ctx.callScripts.push({ leadId, company, phone, hook, script });
      return `"${company}" için arama metni kaydedildi. Sahibin listesine girecek.`;
    },
  });

/**
 * A directive for one day: "bugün atma", "yarın 7 tane at", "bugün sadece web".
 *
 * Mounted only from the owner's own channel, for the same reason
 * `settings_write` is: inbound cold-mail replies are written into the Brain and
 * agents read the Brain, so a prospect can put text in front of an agent. That
 * text must not be able to say "bugün 500 at". The counts are range-checked
 * against the same catalogue bounds as the standing settings, so an absurd
 * number is refused by range rather than by ceremony.
 *
 * No gate: this changes *how many* messages the day prepares, not whether any
 * of them reaches a stranger. Each one still stops at the unconditional
 * `sending_external_messages` gate.
 */
const outreachPlan = (ctx: ToolContext) =>
  betaZodTool({
    name: "outreach_plan",
    description:
      "Bir günün gönderim planını değiştirir — 'bugün atma', 'yarın 7 mail at', 'bugün sadece web'. " +
      "Kalıcı DEĞİL: yalnızca o gün için geçerli, ertesi gün normal ayarlara döner. Kalıcı bir " +
      "değişiklik isteniyorsa settings_write kullan.",
    inputSchema: z.object({
      day: z
        .string()
        .optional()
        .describe("'bugun', 'yarin' ya da 2026-08-25. Boşsa bugün."),
      mailCount: z.number().int().min(0).max(50).optional().describe("O gün gönderilecek mail sayısı."),
      callCount: z.number().int().min(0).max(30).optional().describe("O gün verilecek arama lead'i sayısı."),
      skip: z.boolean().optional().describe("true = o gün hiç gönderim hazırlanmasın."),
      branch: z.enum(["web", "automation"]).optional().describe("Gün tek şubeye daraltıldıysa."),
      focus: z.string().optional().describe("'balıkçılara odaklan' gibi bir yönlendirme."),
      sourceText: z.string().describe("Sahibin tam olarak ne dediği — rapora birebir girecek."),
    }),
    run: async ({ day, mailCount, callCount, skip, branch, focus, sourceText }) => {
      if (!ctx.ownerChannel) {
        return "Bu aracı yalnızca sahibin kendi mesajı üzerine kullanabilirsin.";
      }
      const { dayKey, setPlan, describePlan } = await import("@/lib/outreach/plan");
      const target =
        !day || /^bug[üu]n$/i.test(day)
          ? dayKey()
          : /^yar[ıi]n$/i.test(day)
            ? dayKey(new Date(Date.now() + 86_400_000))
            : day;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) {
        return `Tarihi anlamadım: "${day}". 'bugun', 'yarin' ya da 2026-08-25 biçiminde yaz.`;
      }

      const plan = await setPlan(target, {
        mailCount: mailCount ?? undefined,
        callCount: callCount ?? undefined,
        skip,
        branch,
        focus,
        sourceText,
        saidBy: "owner",
      });
      const when = target === dayKey() ? "Bugün" : target;
      return `${when}: ${describePlan(plan)} — kaydedildi. Yalnızca o gün için; ertesi gün normale döner.`;
    },
  });

/** Numbers out of "1,2,5" or "3 hariç", tolerant of how a phone types them. */
function parseRefs(input: string | number[] | undefined): number[] {
  if (Array.isArray(input)) return input;
  if (!input) return [];
  return String(input)
    .split(/[^0-9]+/)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Applies the owner's one answer to the whole batch.
 *
 * Every item goes out through `settleApproval`, the same function a single
 * `/approve` calls — so batching changes the question, never the path. What
 * comes back is a report of what actually happened, item by item, because a
 * send that failed at the provider is not an approval that failed and the
 * difference matters.
 */
const outreachDecide = (ctx: ToolContext) =>
  betaZodTool({
    name: "outreach_decide",
    description:
      "Günün gönderim partisine verilen cevabı uygular. 'gönder' → send_all, '3 hariç' → send_except, " +
      "'1,2,5' → send_only, 'iptal' → cancel. Ne olduğunu döner; sahibe onu raporla.",
    inputSchema: z.object({
      action: z.enum(["send_all", "send_only", "send_except", "cancel"]),
      numbers: z.array(z.number().int()).optional().describe("send_only / send_except için mail numaraları."),
      reason: z
        .string()
        .optional()
        .describe(
          "Reddedilenler için gerekçe. Gerekçe yazarsan o işletme yarın düzeltilmiş bir taslakla " +
            "döner; yazmazsan bir daha listeye girmez. Sahip sebep söylediyse mutlaka geçir.",
        ),
    }),
    run: async ({ action, numbers, reason }) => {
      const { openBatch } = await import("@/lib/outreach/batch");
      const { applyBatchDecision } = await import("@/lib/outreach/decide");
      const batch = await openBatch();
      if (!batch) return "Açık bir gönderim partisi yok. Onay bekleyen bir şey kalmamış.";

      const picked = parseRefs(numbers);
      if ((action === "send_only" || action === "send_except") && picked.length === 0) {
        return "Hangi numaralar? 'send_only' ve 'send_except' için numara vermen gerekiyor.";
      }
      return applyBatchDecision(batch, action, picked, reason, ctx.agent.id);
    },
  });

/** Reading the day's list, and the full text behind one line of it. */
const outreachBatchRead = () =>
  betaZodTool({
    name: "outreach_batch",
    description:
      "Bugünün gönderim partisini okur. ref verirsen o maddenin tam metnini döner — mail için '2', " +
      "arama için 'A'. Metni sahibe göstermeden önce buradan al, hatırladığını yazma.",
    inputSchema: z.object({
      ref: z.string().optional().describe("Tek bir maddenin tam metni için: '2' ya da 'A'."),
    }),
    run: async ({ ref }) => {
      const { openBatch, itemDetail, renderBatch } = await import("@/lib/outreach/batch");
      const batch = await openBatch();
      if (!batch) return "Açık bir gönderim partisi yok.";
      if (ref) {
        const detail = await itemDetail(batch, ref);
        return detail ?? `"${ref}" diye bir madde yok bu partide.`;
      }
      const db = await getDb();
      const rows = await db
        .select()
        .from(approvals)
        .where(inArray(approvals.id, batch.payload.mail.map((m) => m.approvalId)));
      const drafts = new Map(rows.map((r) => [r.id, r.draft]));
      return renderBatch(batch.payload, drafts);
    },
  });

/* ------------------------------------------------------------ assembly --- */

/**
 * The tool array is heterogeneous — every tool has a different input schema,
 * and some entries are not runnable at all — so it needs the same widened
 * element type the SDK's own `BetaToolRunnerParams.tools` uses.
 *
 * The `BetaToolUnion` half is what lets a server-side tool sit in the same
 * array as a Zod tool: `web_search` and `web_fetch` are declarations, executed
 * by Anthropic rather than here, so they have a `type` and a `name` and no
 * `run()`. Both halves expose `name`, which is all the dedupe below needs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = BetaRunnableTool<any> | BetaToolUnion;

/**
 * Name → builder. Typed against `TOOL_NAMES` so the two cannot drift: a builder
 * whose key is not a declared name fails to compile, and a declared name with
 * no builder here does too. `outreach.plan` is absent on purpose — it is
 * mounted by channel, never by YAML.
 */
const BUILDERS = {
  "brain.read": brainRead,
  "brain.write": brainWrite,
  browser: () => browser(),
  lighthouse: () => lighthouse(),
  "crm.read": crmRead,
  "crm.write": crmWrite,
  "outreach.send": outreachSend,
  "places.search": placesSearch,
  "agent.delegate": delegate,
  "owner.ask": askOwner,
  "owner.answer": () => answerTaskTool(),
  "settings.read": () => settingsRead(),
  "calendar.read": () => calendarRead(),
  "meeting.schedule": meetingSchedule,
  "meeting.update": meetingUpdate,
  "meeting.cancel": meetingCancel,
  money: () => money(),
  "web.search": () => webSearch(),
  "web.fetch": () => webFetch(),
  "outreach.call_script": callScript,
  "outreach.decide": outreachDecide,
  "outreach.batch": () => outreachBatchRead(),
} as const satisfies Record<Exclude<ToolName, never>, (ctx: ToolContext) => AnyTool>;

/**
 * Every agent also gets the gated tools matching its own `approval_required_for`
 * list, so an agent that is *allowed* to send has a way to try — and hits the
 * gate rather than finding no tool at all.
 */
export function toolsFor(ctx: ToolContext): AnyTool[] {
  // Keyed by the tool's *own* name, not by the registry key that produced it.
  // Two registry keys can build the same tool — an agent with `outreach.send`
  // in `tools:` and `sending_external_messages` in `approval_required_for` hits
  // this every time — and keying by registry name sent the API two definitions
  // called `outreach_send` in one request.
  const out = new Map<string, AnyTool>();
  const add = (tool: AnyTool) => {
    // One member of the SDK's tool union is a *toolset* and carries no `name`,
    // so the key falls back to `type` — otherwise every nameless entry would
    // collide on `undefined` and the map would keep exactly one of them.
    const key = "name" in tool ? tool.name : tool.type;
    if (!out.has(key)) out.set(key, tool);
  };

  // The registry already refused to load a YAML naming a tool that does not
  // exist, so an unknown name cannot reach here — but the guard stays, because
  // `toolsFor` is also called with hand-built contexts in tests.
  for (const name of ctx.agent.tools) {
    if (!isToolName(name)) continue;
    add(BUILDERS[name](ctx));
  }

  // An agent that is *allowed* to do a gated thing gets the tool for it, so it
  // hits the gate rather than finding no tool and inventing a way around it.
  for (const gate of ctx.agent.approval_required_for) {
    if (gate === "spending_money") add(spend(ctx));
    if (gate === "sending_external_messages") add(outreachSend(ctx));
  }

  // brain.read is universal: an agent that cannot read the Brain would have to
  // invent business facts, which rule 2 forbids.
  add(brainRead(ctx));

  // Deliberately not grantable from YAML. Writing settings is mounted by
  // *channel*, so a tools: entry can never hand it to an agent that processes
  // untrusted text — see ToolContext.ownerChannel.
  if (ctx.ownerChannel) add(settingsWrite(ctx));
  if (ctx.ownerChannel) add(outreachPlan(ctx));

  return [...out.values()];
}
