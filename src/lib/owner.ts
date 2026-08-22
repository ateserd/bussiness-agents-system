/**
 * The one human in the system. Shows at the tree apex, opens every brief, and
 * names the account the chat channel answers to.
 */
export const OWNER_NAME = "Ateş";
export const OWNER_TITLE = "Kurucu";

/** Europe/Istanbul, per the spec. Used by the scheduler and the brief. */
export const TIMEZONE = "Europe/Istanbul";

/**
 * Inverted against the usual working week: weekday evenings, full weekend days.
 *
 * This is not decoration. Agents run unattended whenever they are scheduled,
 * but anything that *wants the owner* — the morning brief, an approval that
 * blocks a send — has to land where he will see it. The §7 cadences were
 * rewritten around these windows: work is filed *before* a window opens rather
 * than during it, so he starts each session with the reports already waiting.
 */
export const WORKING_HOURS = "Hafta içi 16:00–20:00 · Hafta sonu 09:00–19:00";

/** Machine-readable form of the above, for scheduling decisions. */
export const WORKING_WINDOWS = {
  /** Monday–Friday, 24h clock, Europe/Istanbul. */
  weekday: { start: 16, end: 20 },
  /** Saturday and Sunday. */
  weekend: { start: 9, end: 19 },
} as const;

/** True when `date` falls inside a window where the owner is actually reachable. */
export function isWorkingHour(date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour12: false,
    hour: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
  const day = parts.find((p) => p.type === "weekday")?.value ?? "";
  const window = day === "Sat" || day === "Sun" ? WORKING_WINDOWS.weekend : WORKING_WINDOWS.weekday;
  return hour >= window.start && hour < window.end;
}
