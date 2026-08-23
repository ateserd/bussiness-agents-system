import { and, eq, not, inArray, sql } from "drizzle-orm";
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
 * Two constraints shape the format. It goes *after* the stable role prompt so
 * the cacheable prefix stays byte-identical between runs, and it stays around
 * 200 tokens: this rides along on every message, so verbosity here is a tax on
 * every conversation. Hence one line per section and no prose.
 */

/**
 * Who can be delegated to, and what each is distinctively able to do.
 *
 * Two economies, because this line rides on every message: `brain.read` and
 * `brain.write` are omitted since every agent has them and a universal
 * capability carries no signal, and the list is hard-capped so prompt size
 * stays bounded no matter how large the crew grows.
 */
const UNIVERSAL_TOOLS = new Set(["brain.read", "brain.write"]);
const CREW_LINE_BUDGET = 700;

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
      const [[lead], [deal], [project], [memory]] = await Promise.all([
        db.select({ n: sql<number>`count(*)::int` }).from(leads),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(deals)
          .where(not(inArray(deals.stage, ["won", "lost"]))),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(projects)
          .where(and(eq(projects.stage, "live"))),
        db.select({ n: sql<number>`count(*)::int` }).from(memories),
      ]);
      return { leads: lead?.n ?? 0, deals: deal?.n ?? 0, projects: project?.n ?? 0, memories: memory?.n ?? 0 };
    })(),
  ]);

  const lines: string[] = ["# Sistem haritası (çalışma anında üretildi)"];

  lines.push(`AJANLAR    ${crewLine(crew)}`);

  // Changed settings first: what the owner altered is what he is likely to ask
  // about, and it is what differs from the documented defaults.
  const changed = settings.filter((s) => !s.isDefault);
  const shown = (changed.length > 0 ? changed : settings).slice(0, 8);
  lines.push(
    `AYARLAR    ${shown.map((s) => `${s.key}=${s.value}`).join(" · ")}` +
      (changed.length > 0 ? "  (yalnızca varsayılandan farklı olanlar)" : ""),
  );

  const parkedText =
    parked.length === 0
      ? "sana takılı soru yok"
      : parked.map((t) => `#${shortId(t.id)} "${(t.question ?? "").slice(0, 70)}"`).join(" · ");
  lines.push(`GÖREVLER   ${running.length} çalışıyor · ${parkedText}`);

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
    `RAKAMLAR   ${counts.leads} lead · ${counts.deals} açık fırsat · ${counts.projects} canlı proje · ${counts.memories} anı`,
  );

  lines.push(
    `SAHİP      ${WORKING_HOURS} — şu an ${isWorkingHour() ? "ulaşılabilir" : "muhtemelen müsait değil"}`,
  );

  return lines.join("\n");
}
