import { copy, fmt } from "./copy";
import { getBriefData } from "./data";

/**
 * The §6 morning brief, built from live data.
 *
 * Every number here is counted, never estimated. Where a source is missing the
 * line says so with the reason — §3 rule 3 is the whole point of this file, and
 * the reason it does not simply print zeros.
 */

export type BriefSource = { name: string; reason: string };

export type Brief = {
  date: string;
  web: { openDeals: number; pipelineValue: number; callsToday: number; projects: number; atRisk: number };
  automation: { openDeals: number; pipelineValue: number; live: number; healthy: number; erroring: number };
  cash: { collectedMtd: number; unpaid: number };
  unavailable: BriefSource[];
  needsYou: string[];
};

export async function buildBrief(): Promise<Brief> {
  const { deals, projects, invoices, blocked, pending, clients } = await getBriefData();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const unavailable: BriefSource[] = [];
  if (!process.env.STRIPE_SECRET_KEY) {
    unavailable.push({ name: "Stripe", reason: "STRIPE_SECRET_KEY tanımlı değil" });
  }
  if (!process.env.GOOGLE_CALENDAR_ID && !process.env.CALENDAR_URL) {
    unavailable.push({ name: "Takvim", reason: "takvim kaynağı bağlı değil" });
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

  /* --- what actually needs the owner: capped at three, decision-sized ----- */
  const needsYou: string[] = [];
  for (const a of pending.slice(0, 2)) {
    needsYou.push(`${a.title} — onayını bekliyor.`);
  }
  for (const b of blocked) {
    if (needsYou.length >= 3) break;
    needsYou.push(`${b.displayName} engelli: ${b.blocker ?? "sebep kaydedilmemiş"}`);
  }
  if (needsYou.length < 3) {
    const stalled = deals.filter((d) => d.stalled);
    if (stalled.length > 0) {
      needsYou.push(
        `${stalled.length} fırsat hareketsiz — en eskisi ${stalled[0].title}. Kapatılsın mı, kovalansın mı?`,
      );
    }
  }
  if (needsYou.length < 3) {
    const atRisk = clients.filter((c) => c.health === "at_risk");
    if (atRisk.length > 0) {
      needsYou.push(`${atRisk[0].name} risk sinyali veriyor — arama yapılsın mı?`);
    }
  }

  return {
    date: fmt.day(new Date()),
    web: {
      openDeals: open("web").length,
      pipelineValue: open("web").reduce((n, d) => n + Number(d.valueUsd), 0),
      callsToday: 0,
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
    cash: { collectedMtd: collected, unpaid },
    unavailable,
    needsYou: needsYou.slice(0, 3),
  };
}

/** The exact §6 text format, for the chat channel and `npm run brief`. */
export function renderBrief(brief: Brief, cosName = "Chief of Staff"): string {
  const c = copy.brief;
  const lines: string[] = [];

  lines.push(`☀️ ${c.heading} — ${brief.date}`);
  lines.push(`${cosName}. ${c.intro}`);
  lines.push("");
  lines.push(c.web);
  lines.push(
    `  ${c.pipeline}: ${brief.web.openDeals} ${c.open} · ${fmt.money(brief.web.pipelineValue)} · ${brief.web.callsToday} ${c.callsToday}`,
  );
  lines.push(`  ${c.delivery}: ${brief.web.projects} ${c.projects} · ${brief.web.atRisk} ${c.atRisk}`);
  lines.push(c.automation);
  lines.push(
    `  ${c.pipeline}: ${brief.automation.openDeals} ${c.open} · ${fmt.money(brief.automation.pipelineValue)}`,
  );
  lines.push(
    `  ${c.liveAutomations}: ${brief.automation.healthy} ${c.healthy} / ${brief.automation.erroring} ${c.erroring}`,
  );
  lines.push(c.cash);
  lines.push(`  ${c.collectedMtd}: ${fmt.money(brief.cash.collectedMtd)} · ${c.unpaid}: ${fmt.money(brief.cash.unpaid)}`);

  if (brief.unavailable.length > 0) {
    lines.push("");
    for (const u of brief.unavailable) lines.push(copy.brief.unavailable(u.name, u.reason));
  }

  lines.push("");
  lines.push(`${c.needsYou}:`);
  if (brief.needsYou.length === 0) {
    lines.push(`  ${c.nothingNeedsYou}`);
  } else {
    brief.needsYou.forEach((item, i) => lines.push(`  ${i + 1}. ${item}`));
  }

  return lines.join("\n");
}

/** Three short lines for the Chief of Staff card on the COMMAND deck. */
export function tickerLines(brief: Brief): string[] {
  const lines = [
    `WEB  ${brief.web.openDeals} açık teklif · ${fmt.money(brief.web.pipelineValue)}`,
    `FLOW ${brief.automation.openDeals} açık teklif · ${brief.automation.healthy}/${brief.automation.live} akış sağlıklı`,
  ];
  if (brief.unavailable.length > 0) {
    lines.push(`⚠ ${brief.unavailable[0].name}: ${brief.unavailable[0].reason}`);
  } else {
    lines.push(`NAKİT ${fmt.money(brief.cash.collectedMtd)} tahsil · ${fmt.money(brief.cash.unpaid)} açık`);
  }
  return lines;
}
