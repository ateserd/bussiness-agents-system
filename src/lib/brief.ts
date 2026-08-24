import type { Branch } from "@/db/schema";
import { copy, fmt } from "./copy";
import { getBriefData, getDayActivity } from "./data";
import { fetchDay } from "./integrations/calendar";
import { getSetting } from "./settings";
import { shortId } from "./tasks";

/**
 * The morning brief, built from live data.
 *
 * Every number here is counted, never estimated. Where a source is missing the
 * line says so with the reason — that rule is the whole point of this file and
 * the reason it does not simply print zeros.
 *
 * What changed in Faz 6: it used to be six aggregate numbers, which answered
 * "how big is the pipeline" and nothing the owner had actually asked for. He
 * wanted active, past and potential work — and a count cannot tell him *which*
 * project slips this week or *which* client has gone quiet, which is the only
 * form in which either is actionable. So the sections below name things.
 *
 * The prose around the numbers is written by the Manager (`narrateBrief`); the
 * numbers are injected and never generated. That split is what lets the brief
 * stop sounding like a report without any of its figures becoming a guess.
 */

export type BriefSource = { name: string; reason: string };

export type Meeting = { at: Date; title: string; meetUrl: string | null };

export type ActiveProject = {
  name: string;
  client: string | null;
  branch: Branch;
  stage: string;
  dueInDays: number | null;
  atRisk: boolean;
  healthy: boolean;
};

export type QuietClient = {
  name: string;
  branch: Branch;
  daysQuiet: number;
  everContacted: boolean;
  mrr: number;
};

export type PotentialDeal = {
  title: string;
  branch: Branch;
  stage: string;
  valueUsd: number;
  stalled: boolean;
  daysSinceMove: number;
};

export type Brief = {
  date: string;
  /** Kept as-is: `/branch` and the deck's ticker read these. */
  web: { openDeals: number; pipelineValue: number; callsToday: number; projects: number; atRisk: number };
  automation: { openDeals: number; pipelineValue: number; live: number; healthy: number; erroring: number };
  cash: { collectedMtd: number; unpaid: number; overdue: number };
  today: {
    meetings: Meeting[];
    outreach: { pendingApprovals: number; callsWaiting: number; sentToday: number; planLine: string | null };
  };
  active: ActiveProject[];
  quiet: QuietClient[];
  potential: PotentialDeal[];
  unavailable: BriefSource[];
  needsYou: string[];
};

const DAY_MS = 86_400_000;

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

export async function buildBrief(now = new Date()): Promise<Brief> {
  const { deals, projects, invoices, blocked, pending, clients, parked } = await getBriefData();
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const quietDays = await getSetting("client.quiet_days");
  const today = await fetchDay(now);

  // No Stripe check here: the owner takes payment in cash/IBAN and enters it
  // by hand, by permanent decision, not a pending setup step — collectedMtd
  // below comes from invoices. Nagging about a key that will never exist isn't
  // "report reality", it's noise about a door that was never meant to open.
  const unavailable: BriefSource[] = [];
  if (!today.ok) {
    unavailable.push({ name: "Takvim", reason: today.reason });
  } else if (today.unparsed > 0) {
    // The count would look complete and not be. Say which part is missing.
    unavailable.push({
      name: "Takvim",
      reason: `${today.unparsed} tekrarlayan kayıt çözümlenemedi, bugünün sayısı eksik olabilir`,
    });
  }

  const open = (branch: string) =>
    deals.filter((d) => d.branch === branch && !["won", "lost"].includes(d.stage));

  const webProjects = projects.filter((p) => p.branch === "web");
  const autoProjects = projects.filter((p) => p.branch === "automation" && p.stage === "live");

  const collected = invoices
    .filter((i) => i.state === "paid" && i.paidAt && i.paidAt >= monthStart)
    .reduce((n, i) => n + Number(i.amountUsd), 0);
  const unpaid = invoices
    .filter((i) => i.state === "sent" || i.state === "overdue")
    .reduce((n, i) => n + Number(i.amountUsd), 0);
  const overdue = invoices
    .filter((i) => i.state === "overdue" || (i.state === "sent" && i.dueAt && i.dueAt < now))
    .reduce((n, i) => n + Number(i.amountUsd), 0);

  /* --- today ------------------------------------------------------------- */
  const { openBatch } = await import("@/lib/outreach/batch");
  const batch = await openBatch().catch(() => null);
  const dayCounts = await getDayActivity(new Date(now.getFullYear(), now.getMonth(), now.getDate()));

  /* --- active: every project still ours, named ---------------------------- */
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const active: ActiveProject[] = projects
    .map((p) => ({
      name: p.name,
      client: p.clientId ? (clientById.get(p.clientId)?.name ?? null) : null,
      branch: p.branch,
      stage: p.stage,
      dueInDays: p.dueAt ? daysBetween(now, p.dueAt) : null,
      atRisk: p.atRisk,
      healthy: p.healthy,
    }))
    // Trouble first, then whatever is closest to its date. A brief read on a
    // phone is read from the top, so the ordering is the prioritisation.
    .sort((a, b) => {
      const trouble = Number(b.atRisk || !b.healthy) - Number(a.atRisk || !a.healthy);
      if (trouble !== 0) return trouble;
      return (a.dueInDays ?? 9999) - (b.dueInDays ?? 9999);
    });

  /* --- quiet: the "hatırlat" half ---------------------------------------- */
  const quiet: QuietClient[] = clients
    .filter((c) => c.health !== "churned")
    .map((c) => {
      const last = c.lastContactAt ?? c.startedAt;
      return {
        name: c.name,
        branch: c.branch,
        daysQuiet: daysBetween(last, now),
        everContacted: c.lastContactAt !== null,
        mrr: Number(c.mrrUsd),
      };
    })
    .filter((c) => c.daysQuiet >= quietDays)
    .sort((a, b) => b.daysQuiet - a.daysQuiet);

  /* --- potential ---------------------------------------------------------- */
  const potential: PotentialDeal[] = deals
    .filter((d) => !["won", "lost"].includes(d.stage))
    .map((d) => ({
      title: d.title,
      branch: d.branch,
      stage: d.stage,
      valueUsd: Number(d.valueUsd),
      stalled: d.stalled,
      daysSinceMove: daysBetween(d.lastMovedAt, now),
    }))
    .sort((a, b) => Number(b.stalled) - Number(a.stalled) || b.valueUsd - a.valueUsd);

  /* --- what needs the owner, most-blocking first -------------------------- */
  const needsYou: string[] = [];
  // A parked question outranks a pending card: the card is waiting to be
  // stamped, the question is holding a task still.
  for (const t of parked) {
    needsYou.push(`#${shortId(t.id)} sana soruldu: ${t.question ?? t.title}`);
  }
  if (batch && batch.pending.length > 0) {
    needsYou.push(`${batch.pending.length} taslak günün listesinde onayını bekliyor — "gönder" ya da "iptal".`);
  }
  for (const a of pending) {
    // The batch's own cards are already summarised on the line above.
    if (batch?.pending.some((m) => m.approvalId === a.id)) continue;
    needsYou.push(`${a.title} — onayını bekliyor.`);
  }
  for (const b of blocked) {
    needsYou.push(`${b.displayName} engelli: ${b.blocker ?? "sebep kaydedilmemiş"}`);
  }

  return {
    date: fmt.day(now),
    web: {
      openDeals: open("web").length,
      pipelineValue: open("web").reduce((n, d) => n + Number(d.valueUsd), 0),
      callsToday: today.ok ? today.events.length : 0,
      projects: webProjects.length,
      atRisk: webProjects.filter((p) => p.atRisk).length,
    },
    automation: {
      openDeals: open("automation").length,
      pipelineValue: open("automation").reduce((n, d) => n + Number(d.valueUsd), 0),
      live: autoProjects.length,
      healthy: autoProjects.filter((p) => p.healthy).length,
      erroring: autoProjects.filter((p) => !p.healthy).length,
    },
    cash: { collectedMtd: collected, unpaid, overdue },
    today: {
      meetings: today.ok
        ? today.events.map((e) => ({ at: e.start, title: e.summary, meetUrl: e.meetUrl ?? null }))
        : [],
      outreach: {
        pendingApprovals: batch?.pending.length ?? 0,
        callsWaiting: batch?.payload.call.length ?? 0,
        sentToday: dayCounts.sent,
        planLine: batch?.payload.planLine ?? null,
      },
    },
    active,
    quiet,
    potential,
    unavailable,
    needsYou,
  };
}

/* ------------------------------------------------------------- rendering --- */

const BRANCH_LABEL: Record<string, string> = { web: "web", automation: "flow", shared: "ortak" };

function timeOf(d: Date): string {
  return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(d);
}

/** The deterministic body: counted facts, named things, no prose. */
export function renderBrief(brief: Brief): string {
  const c = copy.brief;
  const lines: string[] = [];

  lines.push(`☀️ ${c.heading} — ${brief.date}`);

  /* --- bugün -------------------------------------------------------------- */
  lines.push("");
  lines.push(c.today);
  if (brief.today.meetings.length === 0) {
    lines.push(`  ${c.noMeetings}`);
  } else {
    for (const m of brief.today.meetings) {
      lines.push(`  ${timeOf(m.at)} · ${m.title}${m.meetUrl ? `\n    ${m.meetUrl}` : ""}`);
    }
  }
  const o = brief.today.outreach;
  const outreachBits = [
    o.sentToday > 0 ? `${o.sentToday} ${c.outreachSentToday}` : null,
    o.pendingApprovals > 0 ? `${o.pendingApprovals} ${c.outreachPending}` : null,
    o.callsWaiting > 0 ? `${o.callsWaiting} ${c.outreachCalls}` : null,
  ].filter(Boolean);
  if (outreachBits.length > 0) lines.push(`  Gönderim: ${outreachBits.join(" · ")}`);
  if (o.planLine) lines.push(`  Plan: ${o.planLine}`);

  /* --- aktif -------------------------------------------------------------- */
  lines.push("");
  lines.push(c.active);
  if (brief.active.length === 0) {
    lines.push(`  ${c.noActive}`);
  } else {
    for (const p of brief.active) {
      const flags = [p.atRisk ? c.atRiskFlag : null, !p.healthy ? c.unhealthyFlag : null].filter(Boolean);
      const due = p.dueInDays === null ? c.noDueDate : c.dueIn(p.dueInDays);
      const who = p.client ? ` (${p.client})` : "";
      lines.push(
        `  ${p.name}${who} · ${BRANCH_LABEL[p.branch]} · ${p.stage} · ${due}${flags.length ? ` · ⚠ ${flags.join(", ")}` : ""}`,
      );
    }
  }

  /* --- potansiyel --------------------------------------------------------- */
  lines.push("");
  lines.push(c.potential);
  if (brief.potential.length === 0) {
    lines.push(`  ${c.noPotential}`);
  } else {
    for (const d of brief.potential) {
      const stalled = d.stalled ? ` · ⚠ ${c.stalledFor(d.daysSinceMove)}` : "";
      lines.push(`  ${d.title} · ${BRANCH_LABEL[d.branch]} · ${d.stage} · ${fmt.money(d.valueUsd)}${stalled}`);
    }
  }

  /* --- sessizleşenler ----------------------------------------------------- */
  lines.push("");
  lines.push(c.quiet);
  if (brief.quiet.length === 0) {
    lines.push(`  ${c.noQuiet}`);
  } else {
    for (const q of brief.quiet) {
      const how = q.everContacted ? c.quietFor(q.daysQuiet) : `${c.neverContacted} (${q.daysQuiet} gün)`;
      const mrr = q.mrr > 0 ? ` · ${fmt.money(q.mrr)}/ay` : "";
      lines.push(`  ${q.name} · ${BRANCH_LABEL[q.branch]} · ${how}${mrr}`);
    }
  }

  /* --- nakit -------------------------------------------------------------- */
  lines.push("");
  lines.push(c.cash);
  lines.push(
    `  ${c.collectedMtd}: ${fmt.money(brief.cash.collectedMtd)} · ${c.unpaid}: ${fmt.money(brief.cash.unpaid)}` +
      (brief.cash.overdue > 0 ? ` · ⚠ vadesi geçen ${fmt.money(brief.cash.overdue)}` : ""),
  );

  if (brief.unavailable.length > 0) {
    lines.push("");
    for (const u of brief.unavailable) lines.push(copy.brief.unavailable(u.name, u.reason));
  }

  /* --- sana düşenler ------------------------------------------------------ */
  lines.push("");
  lines.push(`${c.needsYou}:`);
  if (brief.needsYou.length === 0) {
    lines.push(`  ${c.nothingNeedsYou}`);
  } else {
    brief.needsYou.forEach((item, i) => lines.push(`  ${i + 1}. ${item}`));
  }

  return lines.join("\n");
}

/* ------------------------------------------------------------- narration --- */

/**
 * The Manager's framing around the numbers.
 *
 * Returns null rather than inventing one when no model is available, and the
 * caller sends the figures alone — a brief that silently skipped its framing
 * would be indistinguishable from one where the manager had nothing to say.
 *
 * The numbers are handed over already rendered. The manager never recomputes
 * them, which is what keeps "never fabricate a number" true while still losing
 * the report register the owner disliked.
 */
export async function narrateBrief(brief: Brief, kind: "morning" | "evening" = "morning"): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const { runAgent } = await import("@/lib/agents/run");
  const { rootAgent } = await import("@/lib/agents/registry");
  const body = renderBrief(brief);

  const ask =
    kind === "morning"
      ? [
          "Aşağıda bugünün brifingi var — rakamların hepsi sayıldı, hiçbirini yeniden hesaplama.",
          "",
          body,
          "",
          "Bu listenin TAMAMI sahibe ayrıca gönderiliyor. Senin işin onu tekrarlamak değil:",
          "en fazla üç cümlede, bugün gerçekten dikkatini hak eden şeyi söyle ve ne yapardın onu yaz.",
          "Hiçbir şey acil değilse bunu tek cümlede söyle ve dur — acillik uydurmak kısa bir brifingten kötüdür.",
        ].join("\n")
      : [
          "Gün bitti. Aşağıda günün kapanış rakamları var — hepsi sayıldı, yeniden hesaplama.",
          "",
          body,
          "",
          "En fazla üç cümle: bugün ne çıktı, yarın ilk hangi iş bekliyor.",
        ].join("\n");

  try {
    const result = await runAgent(rootAgent().id, { trigger: "schedule", mode: "chat", task: ask });
    // Only a successful run may frame the brief. A blocked or failed one still
    // returns a summary — now that a daily spend ceiling exists, that summary is
    // "cost ceiling exceeded" — and using it here would print an operational
    // error where the day's editorial belongs. Falling back to no framing is
    // the designed graceful path: the figures below are unaffected.
    if (result.outcome !== "success") return null;
    const text = result.summary.trim();
    return text.length > 0 ? text : null;
  } catch {
    // A brief that fails because its framing failed is worse than a plain one.
    return null;
  }
}

/** Framing on top, figures below — the lock screen shows the first lines. */
/**
 * The narration today's morning push already wrote, or null.
 *
 * This exists because the panel used to call `narrateBrief()` on every render,
 * which was a live money leak: the narration writes an `activity` row, that row
 * changes what `/api/state` reports, the five-second poll sees the change and
 * calls `router.refresh()`, the page re-renders and narrates again. A browser
 * tab left open drove roughly a model call every five seconds, for good.
 *
 * The framing is produced once, by the scheduled morning brief, and stored on
 * that task. Reading it here keeps the panel a mirror — which is what it is
 * supposed to be — and a page render can no longer cost anything.
 */
export async function todaysNarration(now = new Date()): Promise<string | null> {
  try {
    const { getDb } = await import("@/db/client");
    const { tasks } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { dayKey } = await import("@/lib/outreach/plan");
    const db = await getDb();
    const [row] = await db.select().from(tasks).where(eq(tasks.runKey, `brief:${dayKey(now)}`));
    const text = (row?.payload as { narration?: unknown } | null)?.narration;
    return typeof text === "string" && text.trim() ? text : null;
  } catch {
    // A missing framing must never take the board down with it.
    return null;
  }
}

export async function composeBrief(
  brief: Brief,
  kind: "morning" | "evening" = "morning",
): Promise<string> {
  const narration = await narrateBrief(brief, kind);
  const body = renderBrief(brief);
  return narration ? `${narration}\n\n${body}` : body;
}
