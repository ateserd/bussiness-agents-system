import { eq, not, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { deals, leads, memories, projects } from "@/db/schema";
import { allAgents } from "@/lib/agents/registry";
import { calendarWriteConfigured } from "@/lib/integrations/google-calendar";
import { calendarConfigured } from "@/lib/integrations/calendar";
import { placesConfigured } from "@/lib/integrations/places";
import { resendConfigured } from "@/lib/integrations/resend";
import { notifyConfigured } from "@/lib/chat/notify";
import { allSettings } from "@/lib/settings";
import { openQuestions, runningTasks, shortId } from "@/lib/tasks";
import { WORKING_HOURS, isWorkingHour } from "@/lib/owner";

/**
 * A compact picture of the whole system, rebuilt each run and appended to the
 * manager's prompt.
 *
 * "Baş agent tüm sistemi tanımalı" is not something a static prompt can deliver
 * — the crew, the settings, what is in flight and which integrations actually
 * answer all change under it. So it is assembled from live state instead of
 * written down and left to rot.
 *
 * Two constraints shape the format. It goes *after* everything stable in the
 * prompt, on the volatile side of the cache breakpoint `prompt.ts` sets — this
 * block changes every run, so anything cached must precede it. And it stays
 * small: measured at ~1000 characters with four agents, and it rides along on
 * every message, so verbosity here is a tax on every conversation. Hence one
 * line per section and no prose.
 *
 * Nothing here may take a run down. The map is context, not capability: a
 * database hiccup should cost the manager its map, never its ability to answer.
 * Every section degrades to a `⚠️` line of its own and the caller catches what
 * is left — the same rule the agents themselves operate under.
 */

/**
 * Who can be delegated to, and what each is distinctively able to do.
 *
 * Three economies, because this line rides on every message: `brain.read` and
 * `brain.write` are omitted since every agent has them and a universal
 * capability carries no signal; the list is hard-capped so prompt size stays
 * bounded no matter how large the crew grows; and it carries only *tools* —
 * what each agent is for is already written out in the manager's role prompt,
 * and paying for that sentence twice on every message buys nothing.
 */
const UNIVERSAL_TOOLS = new Set(["brain.read", "brain.write"]);
const CREW_LINE_BUDGET = 700;
const SETTINGS_SHOWN = 8;

function crewLine(crew: ReturnType<typeof allAgents>): string {
  const entries = crew
    .filter((a) => a.reports_to !== null)
    .map((a) => {
      const distinctive = a.tools.filter((t) => !UNIVERSAL_TOOLS.has(t));
      return distinctive.length > 0 ? `${a.id}(${distinctive.join(",")})` : a.id;
    });

  const kept: string[] = [];
  let used = 0;
  for (const e of entries) {
    if (used + e.length + 3 > CREW_LINE_BUDGET) break;
    kept.push(e);
    used += e.length + 3;
  }
  const rest = entries.length - kept.length;
  return kept.join(" · ") + (rest > 0 ? ` · (+${rest} ajan daha)` : "");
}

function tick(ok: boolean, label: string, missing: string): string {
  return ok ? `${label}✓` : `${label}✗(${missing})`;
}

export async function buildSystemMap(): Promise<string> {
  const crew = allAgents();
  const db = await getDb();

  const [settings, running, parked, counts] = await Promise.all([
    allSettings(),
    runningTasks(),
    openQuestions(),
    (async () => {
      try {
        const [[lead], [deal], [project], [live], [memory]] = await Promise.all([
          db.select({ n: sql<number>`count(*)::int` }).from(leads),
          db
            .select({ n: sql<number>`count(*)::int` })
            .from(deals)
            .where(not(inArray(deals.stage, ["won", "lost"]))),
          // Two project numbers, because "kaç projem var" has two honest
          // answers: everything still ours, and the subset already delivered
          // or running. Counting only `live` made the map say "1 proje" while
          // the brief listed three — same agent, two surfaces, two answers.
          db.select({ n: sql<number>`count(*)::int` }).from(projects),
          db
            .select({ n: sql<number>`count(*)::int` })
            .from(projects)
            .where(eq(projects.stage, "live")),
          db.select({ n: sql<number>`count(*)::int` }).from(memories),
        ]);
        return {
          leads: lead?.n ?? 0,
          deals: deal?.n ?? 0,
          projects: project?.n ?? 0,
          live: live?.n ?? 0,
          memories: memory?.n ?? 0,
          error: null as string | null,
        };
      } catch (err) {
        return { leads: 0, deals: 0, projects: 0, live: 0, memories: 0, error: (err as Error).message };
      }
    })(),
  ]);

  const lines: string[] = ["# Sistem haritası (çalışma anında üretildi)"];

  lines.push(`AJANLAR    ${crewLine(crew)}`);

  // Changed settings first: what the owner altered is what he is likely to ask
  // about, and it is what differs from the documented defaults.
  //
  // The tail is *named*, not dropped. There are 17 settings and room for 8; a
  // silent slice let the manager recite a list it had every reason to believe
  // was complete. `settings_read` is one call away — it only has to know to
  // make it.
  const changed = settings.filter((s) => !s.isDefault);
  const pool = changed.length > 0 ? changed : settings;
  const shown = pool.slice(0, SETTINGS_SHOWN);
  const hidden = pool.length - shown.length;
  const suffix = [
    changed.length > 0 ? "yalnızca varsayılandan farklı olanlar" : "hepsi varsayılan",
    hidden > 0 ? `+${hidden} ayar daha, settings_read ile hepsi` : null,
  ]
    .filter(Boolean)
    .join("; ");
  lines.push(`AYARLAR    ${shown.map((s) => `${s.key}=${s.value}`).join(" · ")}  (${suffix})`);

  const parkedText =
    parked.length === 0
      ? "sana takılı soru yok"
      : parked.map((t) => `#${shortId(t.id)} "${(t.question ?? "").slice(0, 70)}"`).join(" · ");
  // The day's batch is also something waiting on him, and it is invisible in
  // the task rows: it settles through approvals, not through an answer.
  const { openBatch } = await import("@/lib/outreach/batch");
  const batch = await openBatch().catch(() => null);
  const batchText = batch ? ` · ${batch.pending.length} taslak onayını bekliyor` : "";
  lines.push(`GÖREVLER   ${running.length} çalışıyor · ${parkedText}${batchText}`);

  lines.push(
    `KAYNAKLAR  ${[
      tick(Boolean(process.env.ANTHROPIC_API_KEY), "model", "ANTHROPIC_API_KEY yok"),
      tick(resendConfigured(), "mail", "RESEND_API_KEY yok"),
      tick(placesConfigured(), "places", "GOOGLE_PLACES_API_KEY yok"),
      // Two different capabilities, and conflating them would let the manager
      // promise a booking it can only read. Write is the OAuth path; the .ics
      // feed underneath can still answer "what is today".
      tick(calendarWriteConfigured(), "takvim-yaz", "Google OAuth yok"),
      tick(calendarConfigured(), "takvim-oku", "takvim kaynağı yok"),
      tick(notifyConfigured(), "telegram", "token/chat yok"),
    ].join(" ")}`,
  );

  lines.push(
    counts.error
      ? `RAKAMLAR   ⚠️ okunamadı (${counts.error})`
      : `RAKAMLAR   ${counts.leads} lead · ${counts.deals} açık fırsat · ` +
        `${counts.projects} proje (${counts.live} canlı) · ${counts.memories} anı`,
  );

  lines.push(
    `SAHİP      ${WORKING_HOURS} — şu an ${isWorkingHour() ? "ulaşılabilir" : "muhtemelen müsait değil"}`,
  );

  return lines.join("\n");
}
