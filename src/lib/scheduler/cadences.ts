import { allAgents } from "@/lib/agents/registry";

/**
 * The §7 cadence table, as data.
 *
 * Most cadences are already expressed as each agent's `schedule:` in its YAML —
 * this file holds the ones that are *not* one-agent-one-cron: the Chief of
 * Staff's second daily run, and the rollups that fan out to several agents at
 * once. Everything the scheduler fires comes from `dueRuns()` below.
 *
 * Times are Europe/Istanbul. Cron is evaluated in that zone by `tick.ts`.
 *
 * Only one entry survives, and the reason is worth knowing before adding
 * another: `dueRuns()` dedupes per agent, and YAML-derived runs are pushed
 * first, so any cadence here whose cron equals its agent's own `schedule:`
 * loses the tie and never delivers its task text. Five entries sat here doing
 * exactly that — the agent ran, but on the generic YAML task, so the bespoke
 * wording was dead code pretending to be configuration. `cos.evening_wrap`
 * works only because 19:00 differs from the Chief of Staff's own 07:30.
 *
 * So: an entry here MUST have a cron its target agent does not already carry.
 */

export type Cadence = {
  id: string;
  cron: string;
  /** Agent ids to run, or a selector over the crew. */
  agents: string[] | ((ids: string[]) => string[]);
  task: string;
  label: string;
};

export const EXTRA_CADENCES: Cadence[] = [
  {
    id: "cos.evening_wrap",
    cron: "0 19 * * *",
    agents: ["shared.command.chief_of_staff"],
    label: "Gün sonu özeti",
    task: "Gün sonu özetini yaz: bugün ne çıktı, ne kaydı, yarının ilk üç işi ne. Sayılarla başla.",
  },
];

export type PlannedRun = {
  agentId: string;
  cadenceId: string;
  label: string;
  task: string;
  cron: string;
};

/** Every scheduled run the system knows about, from YAML plus the table above. */
export function allCadences(): PlannedRun[] {
  const crew = allAgents();
  const ids = crew.map((a) => a.id);
  const out: PlannedRun[] = [];

  for (const agent of crew) {
    if (!agent.schedule) continue;
    out.push({
      agentId: agent.id,
      cadenceId: `${agent.id}.schedule`,
      label: `${agent.display_name} — programlı çalışma`,
      task: "Programlı görevini yürüt ve sonucu raporla.",
      cron: agent.schedule,
    });
  }

  for (const cadence of EXTRA_CADENCES) {
    const targets = typeof cadence.agents === "function" ? cadence.agents(ids) : cadence.agents;
    for (const agentId of targets) {
      if (!ids.includes(agentId)) continue;
      out.push({
        agentId,
        cadenceId: cadence.id,
        label: cadence.label,
        task: cadence.task,
        cron: cadence.cron,
      });
    }
  }

  return out;
}

/* -------------------------------------------------------------------------
   Minimal 5-field cron matcher. Enough for the cadences above; deliberately
   not a full cron implementation — if the schedules ever need step syntax
   beyond */
/* N or ranges, swap in a real parser rather than growing this.
------------------------------------------------------------------------- */

function matchField(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (part.startsWith("*/")) {
      const step = Number(part.slice(2));
      if (Number.isFinite(step) && step > 0 && (value - min) % step === 0) return true;
      continue;
    }
    if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      if (Number.isFinite(a) && Number.isFinite(b) && value >= a && value <= b) return true;
      continue;
    }
    if (Number(part) === value) return true;
  }
  void max;
  return false;
}

export function cronMatches(cron: string, date: Date, timeZone = "Europe/Istanbul"): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, month, dow] = parts;

  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    minute: "2-digit",
    hour: "2-digit",
    day: "2-digit",
    month: "2-digit",
    weekday: "short",
  });
  const bits = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    matchField(min, Number(bits.minute), 0, 59) &&
    matchField(hour, Number(bits.hour), 0, 23) &&
    matchField(dom, Number(bits.day), 1, 31) &&
    matchField(month, Number(bits.month), 1, 12) &&
    matchField(dow, dayNames.indexOf(bits.weekday ?? "Sun"), 0, 6)
  );
}

/** Runs due at `now`, deduplicated per agent so one tick never double-fires. */
export function dueRuns(now = new Date()): PlannedRun[] {
  const seen = new Set<string>();
  return allCadences().filter((run) => {
    if (!cronMatches(run.cron, now)) return false;
    if (seen.has(run.agentId)) return false;
    seen.add(run.agentId);
    return true;
  });
}

/** Idempotency key: one run per agent per cadence per minute. */
export function runKeyFor(run: PlannedRun, now = new Date()): string {
  return `${run.agentId}:${run.cadenceId}:${now.toISOString().slice(0, 16)}`;
}
