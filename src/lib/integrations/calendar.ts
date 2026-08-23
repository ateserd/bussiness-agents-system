/**
 * Today's calls, read from an iCalendar feed (§5).
 *
 * `CALENDAR_URL` is a secret-address .ics feed — Google Calendar's "Secret
 * address in iCal format", or the equivalent from any other calendar. That
 * route needs no OAuth flow and no stored refresh token, which is why it is
 * the one wired here rather than the Calendar API.
 *
 * ICS is a bigger format than this parser. That matters, because a brief that
 * silently misses a recurring standup reports "2 calls today" when there are
 * three, and a wrong number is worse than a missing one. So anything this
 * parser cannot expand with confidence is counted separately and surfaced as
 * `unparsed`, and the caller reports the gap rather than a clean-looking total.
 *
 * Handled: non-recurring events, and RRULE FREQ=DAILY/WEEKLY/MONTHLY with
 * INTERVAL, COUNT, UNTIL, BYDAY and EXDATE. Anything else — FREQ=YEARLY,
 * BYSETPOS, BYMONTHDAY and friends — counts as unparsed.
 */

import { calendarWriteConfigured, listRange } from "./google-calendar";

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 5 * 1024 * 1024;

export type CalendarDay =
  | { ok: true; events: CalendarEvent[]; unparsed: number }
  | { ok: false; reason: string };

export type CalendarEvent = { start: Date; summary: string; meetUrl?: string | null };

type VEvent = {
  start?: Date;
  summary: string;
  rrule?: string;
  exdates: Set<string>;
};

export function calendarConfigured(): boolean {
  return Boolean(process.env.CALENDAR_URL) || calendarWriteConfigured();
}

/** Local-day key, so comparisons never cross a timezone boundary by accident. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** ICS folds long lines by starting the continuation with a space or tab. */
function unfold(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** `20260822T093000Z`, `20260822T093000`, or `20260822` for all-day. */
function parseIcsDate(value: string): Date | undefined {
  const v = value.trim();
  const utc = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v);
  if (utc) {
    const [, y, mo, d, h, mi, s] = utc;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  }
  const local = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(v);
  if (local) {
    const [, y, mo, d, h, mi, s] = local;
    return new Date(+y, +mo - 1, +d, +h, +mi, +s);
  }
  const allDay = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (allDay) {
    const [, y, mo, d] = allDay;
    return new Date(+y, +mo - 1, +d);
  }
  return undefined;
}

const BYDAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/**
 * Does this event fall on `target`? Returns `undefined` when the rule is one
 * this parser does not understand, which the caller counts as unparsed rather
 * than as a "no".
 */
function occursOn(event: VEvent, target: Date): boolean | undefined {
  if (!event.start) return undefined;
  const key = dayKey(target);

  if (event.exdates.has(key)) return false;
  if (!event.rrule) return dayKey(event.start) === key;

  const rule = Object.fromEntries(
    event.rrule
      .split(";")
      .map((p) => p.split("="))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k.toUpperCase(), v]),
  ) as Record<string, string>;

  const freq = rule.FREQ?.toUpperCase();
  if (!freq || !["DAILY", "WEEKLY", "MONTHLY"].includes(freq)) return undefined;
  // Any selector beyond BYDAY changes which days match; refuse rather than guess.
  if (Object.keys(rule).some((k) => k.startsWith("BY") && k !== "BYDAY")) return undefined;

  if (target < new Date(event.start.getFullYear(), event.start.getMonth(), event.start.getDate())) {
    return false;
  }
  if (rule.UNTIL) {
    const until = parseIcsDate(rule.UNTIL);
    if (until && target > until) return false;
  }

  const interval = Number(rule.INTERVAL ?? 1);
  if (!Number.isFinite(interval) || interval < 1) return undefined;

  const startDay = new Date(
    event.start.getFullYear(),
    event.start.getMonth(),
    event.start.getDate(),
  );
  const daysApart = Math.round((target.getTime() - startDay.getTime()) / 86_400_000);

  // COUNT bounds the series; without expanding it we cannot know we are inside.
  if (rule.COUNT) {
    const count = Number(rule.COUNT);
    if (!Number.isFinite(count)) return undefined;
    if (freq === "DAILY" && daysApart >= count * interval) return false;
    if (freq === "WEEKLY" && daysApart >= count * interval * 7) return false;
    if (freq === "MONTHLY" && daysApart >= count * interval * 31) return false;
  }

  if (freq === "DAILY") return daysApart % interval === 0;

  if (freq === "WEEKLY") {
    const days = rule.BYDAY
      ? rule.BYDAY.split(",").map((d) => BYDAY_INDEX[d.trim().toUpperCase().slice(-2)])
      : [event.start.getDay()];
    if (days.some((d) => d === undefined)) return undefined;
    if (!days.includes(target.getDay())) return false;
    const weeksApart = Math.floor(daysApart / 7);
    return weeksApart % interval === 0;
  }

  // MONTHLY, on the same day-of-month as DTSTART.
  if (rule.BYDAY) return undefined;
  if (target.getDate() !== event.start.getDate()) return false;
  const monthsApart =
    (target.getFullYear() - event.start.getFullYear()) * 12 +
    (target.getMonth() - event.start.getMonth());
  return monthsApart % interval === 0;
}

function parseEvents(raw: string): VEvent[] {
  const events: VEvent[] = [];
  let current: VEvent | null = null;

  for (const line of unfold(raw)) {
    if (line.startsWith("BEGIN:VEVENT")) {
      current = { summary: "(başlıksız)", exdates: new Set() };
      continue;
    }
    if (line.startsWith("END:VEVENT")) {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon).toUpperCase();
    const value = line.slice(colon + 1);

    if (name.startsWith("DTSTART")) current.start = parseIcsDate(value);
    else if (name === "SUMMARY") current.summary = value.replace(/\\,/g, ",").replace(/\\n/gi, " ").trim() || current.summary;
    else if (name === "RRULE") current.rrule = value;
    else if (name.startsWith("EXDATE")) {
      for (const part of value.split(",")) {
        const d = parseIcsDate(part);
        if (d) current.exdates.add(dayKey(d));
      }
    }
  }
  return events;
}

/**
 * Events on `target` (default: today).
 *
 * OAuth first when it is configured: it is the same calendar, but it returns
 * Google's own expansion of every recurrence rule — including the ones this
 * parser declines — plus the Meet link, so `unparsed` is genuinely zero rather
 * than merely small. The `.ics` feed stays underneath for a box where the OAuth
 * setup was never finished, which is the only reason that parser still exists.
 */
export async function fetchDay(target = new Date()): Promise<CalendarDay> {
  if (calendarWriteConfigured()) {
    const from = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    const to = new Date(from.getTime() + 86_400_000);
    const res = await listRange(from, to);
    if (res.ok) {
      return {
        ok: true,
        unparsed: 0,
        events: res.meetings.map((m) => ({ start: m.start, summary: m.summary, meetUrl: m.meetUrl })),
      };
    }
    // Fall through to the feed rather than failing: a broken token should cost
    // the Meet links, not the whole brief.
  }

  const url = process.env.CALENDAR_URL;
  if (!url) return { ok: false, reason: "CALENDAR_URL tanımlı değil" };

  let raw: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { ok: false, reason: `takvim ${res.status}` };
    raw = await res.text();
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  if (raw.length > MAX_BYTES) return { ok: false, reason: "takvim beslemesi çok büyük" };
  if (!raw.includes("BEGIN:VCALENDAR")) return { ok: false, reason: "geçerli bir iCalendar değil" };

  const events: CalendarEvent[] = [];
  let unparsed = 0;

  for (const event of parseEvents(raw)) {
    const hit = occursOn(event, target);
    if (hit === undefined) {
      unparsed++;
    } else if (hit && event.start) {
      // A recurring event's DTSTART is when the series began, not when it
      // happens today. Carry the time of day onto the target date, so both the
      // ordering below and anything that prints a time are about today.
      const start = new Date(
        target.getFullYear(),
        target.getMonth(),
        target.getDate(),
        event.start.getHours(),
        event.start.getMinutes(),
        event.start.getSeconds(),
      );
      events.push({ start, summary: event.summary });
    }
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { ok: true, events, unparsed };
}
