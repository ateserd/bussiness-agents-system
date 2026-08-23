import { randomUUID } from "node:crypto";
import { getSetting } from "@/lib/settings";

/**
 * The owner's calendar, for real — create a meeting, move it, cancel it, and
 * mint a Google Meet link while doing it.
 *
 * This is a second calendar path, not a replacement. `calendar.ts` reads a
 * secret-address `.ics` feed: no OAuth, no stored token, and no way to write.
 * That was enough while the brief only had to *say* what today looks like. It
 * is not enough to book anything, so this adds the OAuth half and the `.ics`
 * half stays as the read fallback for a box where OAuth was never finished.
 *
 * **Nothing here is called without an approval.** The gate lives in
 * `meeting_schedule` / `meeting_update` / `meeting_cancel` in `tools.ts` and is
 * unconditional, exactly like `outreach_send`: creating, changing and
 * cancelling all reach the owner on Telegram first, and no YAML edit or
 * autonomy setting can open a path around it. This module is the hands; it does
 * not decide.
 *
 * Google mails the attendees itself (`sendUpdates=all`), which is why nothing
 * here also sends through Resend — that would put two invitations for one
 * meeting in a client's inbox.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
const TIMEOUT_MS = 15_000;

/** The scope `npm run google:auth` asks for, named once so both agree. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export function calendarWriteConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN,
  );
}

function calendarId(): string {
  return process.env.GOOGLE_CALENDAR_ID || "primary";
}

/* ------------------------------------------------------------------ auth --- */

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  if (!calendarWriteConfigured()) {
    return { ok: false, reason: "GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN tanımlı değil" };
  }
  // A minute of slack, so a token that expires mid-request is refreshed before
  // it is used rather than producing a confusing 401.
  if (token && Date.now() < token.expiresAt - 60_000) return { ok: true, token: token.value };

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN as string,
        client_id: process.env.GOOGLE_CLIENT_ID as string,
        client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
      }),
    });
    const body = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!res.ok || !body.access_token) {
      return { ok: false, reason: body.error_description ?? body.error ?? `token ${res.status}` };
    }
    token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return { ok: true, token: token.value };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; reason: string };

async function api<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const auth = await accessToken();
  if (!auth.ok) return auth;

  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${auth.token}`,
        "content-type": "application/json",
      },
    });
    // DELETE answers 204 with an empty body.
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : ({} as T);
    if (!res.ok) {
      const err = data as unknown as { error?: { message?: string } };
      return { ok: false, reason: err.error?.message ?? `takvim ${res.status}` };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

/* ------------------------------------------------------------------ time --- */

/**
 * A wall-clock time with no offset (`2026-08-25T14:00`) and a wall-clock time
 * that carries one (`...T14:00+03:00`, `...Z`) are different things, and the
 * difference decides whether Google is told a timezone or told an instant.
 *
 * Floating is the common case: the model writes what the owner said. Google
 * accepts `{ dateTime, timeZone }` and resolves it, so the timezone never has
 * to be applied here — which is the whole reason no date library is needed.
 * The end time is computed by wall-clock arithmetic in UTC, which is exact for
 * a zone without DST (Turkey since 2016) and can be off by an hour only for an
 * event that straddles a DST switch elsewhere.
 */
const FLOATING = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const ABSOLUTE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

export type EventTime = { dateTime: string; timeZone: string };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function floatingFrom(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** An unknown zone must not silently become UTC — fall back to the default. */
function safeTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "Europe/Istanbul";
  }
}

export function timeRange(
  startsAt: string,
  durationMin: number,
  timeZone: string,
): { ok: true; start: EventTime; end: EventTime } | { ok: false; reason: string } {
  const tz = safeTimeZone(timeZone);
  const raw = startsAt.trim();

  const floating = FLOATING.exec(raw);
  if (floating) {
    const [, y, mo, d, h, mi, s] = floating;
    const base = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0));
    return {
      ok: true,
      start: { dateTime: floatingFrom(new Date(base)), timeZone: tz },
      end: { dateTime: floatingFrom(new Date(base + durationMin * 60_000)), timeZone: tz },
    };
  }

  if (ABSOLUTE.test(raw)) {
    const start = new Date(raw);
    if (Number.isNaN(start.getTime())) return { ok: false, reason: `tarih okunamadı: ${startsAt}` };
    return {
      ok: true,
      start: { dateTime: start.toISOString(), timeZone: tz },
      end: { dateTime: new Date(start.getTime() + durationMin * 60_000).toISOString(), timeZone: tz },
    };
  }

  return {
    ok: false,
    reason: `tarih biçimi anlaşılmadı: "${startsAt}". Beklenen: 2026-08-25T14:00`,
  };
}

/* ---------------------------------------------------------------- events --- */

export type Meeting = {
  id: string;
  summary: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  meetUrl: string | null;
  htmlLink: string | null;
  attendees: string[];
};

type RawEvent = {
  id?: string;
  summary?: string;
  status?: string;
  hangoutLink?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string }[];
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
};

function toMeeting(e: RawEvent): Meeting | null {
  const startRaw = e.start?.dateTime ?? e.start?.date;
  if (!e.id || !startRaw) return null;
  const start = new Date(startRaw);
  if (Number.isNaN(start.getTime())) return null;
  const endRaw = e.end?.dateTime ?? e.end?.date;
  const end = endRaw ? new Date(endRaw) : null;

  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
  return {
    id: e.id,
    summary: e.summary?.trim() || "(başlıksız)",
    start,
    end: end && !Number.isNaN(end.getTime()) ? end : null,
    allDay: Boolean(e.start?.date),
    meetUrl: e.hangoutLink ?? video ?? null,
    htmlLink: e.htmlLink ?? null,
    attendees: (e.attendees ?? []).map((a) => a.email).filter((x): x is string => Boolean(x)),
  };
}

export type MeetingResult = { ok: true; meeting: Meeting } | { ok: false; reason: string };
export type MeetingList = { ok: true; meetings: Meeting[] } | { ok: false; reason: string };

export async function listRange(from: Date, to: Date, max = 25): Promise<MeetingList> {
  const params = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(max),
  });
  const res = await api<{ items?: RawEvent[] }>(
    `/calendars/${encodeURIComponent(calendarId())}/events?${params}`,
  );
  if (!res.ok) return res;
  const meetings = (res.data.items ?? [])
    .filter((e) => e.status !== "cancelled")
    .map(toMeeting)
    .filter((m): m is Meeting => m !== null);
  return { ok: true, meetings };
}

export async function listUpcoming(days: number, max = 25): Promise<MeetingList> {
  const now = new Date();
  return listRange(now, new Date(now.getTime() + days * 86_400_000), max);
}

export async function createMeeting(input: {
  title: string;
  startsAt: string;
  durationMin: number;
  attendeeEmails: string[];
  description?: string;
  withMeet?: boolean;
}): Promise<MeetingResult> {
  const tz = await getSetting("owner.timezone");
  const range = timeRange(input.startsAt, input.durationMin, tz);
  if (!range.ok) return range;

  const withMeet = input.withMeet !== false;
  const body: Record<string, unknown> = {
    summary: input.title,
    description: input.description,
    start: range.start,
    end: range.end,
    attendees: input.attendeeEmails.map((email) => ({ email })),
  };
  if (withMeet) {
    body.conferenceData = {
      createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
  }

  // conferenceDataVersion=1 is what actually mints the Meet link; without it
  // Google accepts the request and silently drops conferenceData.
  const params = new URLSearchParams({ sendUpdates: "all", conferenceDataVersion: withMeet ? "1" : "0" });
  const res = await api<RawEvent>(`/calendars/${encodeURIComponent(calendarId())}/events?${params}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) return res;
  const meeting = toMeeting(res.data);
  return meeting ? { ok: true, meeting } : { ok: false, reason: "takvim beklenmeyen bir yanıt döndü" };
}

export async function updateMeeting(input: {
  eventId: string;
  title?: string;
  startsAt?: string;
  durationMin?: number;
  attendeeEmails?: string[];
  description?: string;
}): Promise<MeetingResult> {
  const body: Record<string, unknown> = {};
  if (input.title) body.summary = input.title;
  if (input.description) body.description = input.description;
  if (input.attendeeEmails) body.attendees = input.attendeeEmails.map((email) => ({ email }));

  if (input.startsAt) {
    // Moving the start without a duration would leave the old end behind it, so
    // the duration is resolved from the setting rather than left to chance.
    const tz = await getSetting("owner.timezone");
    const minutes = input.durationMin ?? (await getSetting("meeting.default_duration_min"));
    const range = timeRange(input.startsAt, minutes, tz);
    if (!range.ok) return range;
    body.start = range.start;
    body.end = range.end;
  }

  if (Object.keys(body).length === 0) return { ok: false, reason: "değiştirilecek bir alan verilmedi" };

  const res = await api<RawEvent>(
    `/calendars/${encodeURIComponent(calendarId())}/events/${encodeURIComponent(input.eventId)}?sendUpdates=all`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
  if (!res.ok) return res;
  const meeting = toMeeting(res.data);
  return meeting ? { ok: true, meeting } : { ok: false, reason: "takvim beklenmeyen bir yanıt döndü" };
}

export async function cancelMeeting(eventId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const res = await api<unknown>(
    `/calendars/${encodeURIComponent(calendarId())}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: "DELETE" },
  );
  return res.ok ? { ok: true } : res;
}

/** One line per meeting, in the shape the owner reads on his phone. */
export function describe(m: Meeting): string {
  const when = m.allDay
    ? m.start.toLocaleDateString("tr-TR")
    : m.start.toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
  const who = m.attendees.length > 0 ? ` · ${m.attendees.join(", ")}` : "";
  const meet = m.meetUrl ? ` · ${m.meetUrl}` : "";
  return `${when} — ${m.summary}${who}${meet} · id:${m.id}`;
}
