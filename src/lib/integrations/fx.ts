import { getSetting } from "@/lib/settings";

/**
 * TL → USD, at a rate someone can be shown.
 *
 * Every money column in the schema is `*_usd numeric`, but the business is
 * quoted, invoiced and paid in lira. Until now that gap was unbridgeable: an
 * agent told "bu proje 45 bin TL" had no way to write it down, and the one
 * thing it must never do is guess a rate. So this exists, and its whole
 * contract is that it either returns a rate it actually fetched, together with
 * the date that rate belongs to, or it returns why it could not.
 *
 * **`asOf` is not decoration.** TCMB publishes once per business day; asking on
 * a Sunday correctly returns Friday's rate. That is right, not stale — but a
 * figure converted at Friday's rate and presented as today's is a small lie, so
 * every caller is handed the date and the house style prints it.
 *
 * Two sources, because the source is a setting (`fx.source`). TCMB is the rate
 * a Turkish accountant would use and is the default; `erapi` is there so a flaky
 * primary is one Telegram sentence away from being switched, rather than a code
 * change. Both are parsed defensively — the field names below are asserted, not
 * assumed, and anything that does not match fails loudly.
 */

export type Rate = { ok: true; usdTry: number; asOf: Date; source: string } | { ok: false; reason: string };

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * A rate outside this band is a parse failure, not a rate. It means we matched
 * `<Unit>`, a `CrossOrder`, or read the decimal separator wrong — all of which
 * produce a number that looks fine and is off by orders of magnitude. Wide
 * enough to stay correct for decades; narrow enough to catch every one of
 * those.
 */
const PLAUSIBLE_MIN = 5;
const PLAUSIBLE_MAX = 10_000;

/** Rates move once a business day, so re-fetching more often buys nothing. */
const OK_TTL_MS = 6 * 60 * 60 * 1000;
/** A source that is down should not be hammered once per agent turn. */
const FAIL_TTL_MS = 5 * 60 * 1000;

let cache: { at: number; key: string; rate: Rate } | null = null;

async function fetchText(url: string): Promise<{ ok: true; body: string } | { ok: false; reason: string }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "MissionControl/0.1 (+fx)" },
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const body = await res.text();
    if (body.length > MAX_BYTES) return { ok: false, reason: "yanıt beklenenden büyük" };
    return { ok: true, body };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

/** TCMB writes `34.2345`; accept a comma too rather than trusting one form. */
function toNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** `DD.MM.YYYY` from the root element's `Tarih` attribute. */
function parseTcmbDate(xml: string): Date | null {
  const m = /Tarih="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  if (!m) return null;
  const [, d, mo, y] = m;
  return new Date(+y, +mo - 1, +d);
}

async function fromTcmb(): Promise<Rate> {
  const res = await fetchText("https://www.tcmb.gov.tr/kurlar/today.xml");
  if (!res.ok) return { ok: false, reason: `TCMB (${res.reason})` };

  const block = /<Currency[^>]*(?:Kod|CurrencyCode)="USD"[^>]*>([\s\S]*?)<\/Currency>/i.exec(res.body);
  if (!block) return { ok: false, reason: "TCMB (yanıtta USD kuru bulunamadı)" };

  // ForexSelling is the rate a business converting lira to dollars actually
  // faces. Buying and the banknote rates are the documented fallbacks in
  // descending order of relevance, tried only if the field is absent.
  const body = block[1];
  const field = (name: string) => {
    const m = new RegExp(`<${name}>([^<]*)</${name}>`, "i").exec(body);
    return toNumber(m?.[1]);
  };
  const raw = field("ForexSelling") ?? field("ForexBuying") ?? field("BanknoteSelling");
  if (raw === null) return { ok: false, reason: "TCMB (kur alanı okunamadı)" };

  // TCMB quotes some currencies per 100 units. USD is per 1, but reading Unit
  // costs nothing and a silent 100× error would be unrecoverable.
  const unit = field("Unit") ?? 1;
  const usdTry = unit > 0 ? raw / unit : raw;
  if (usdTry < PLAUSIBLE_MIN || usdTry > PLAUSIBLE_MAX) {
    return { ok: false, reason: `TCMB (okunan kur mantıksız: ${usdTry})` };
  }

  const asOf = parseTcmbDate(res.body);
  if (!asOf) return { ok: false, reason: "TCMB (kur tarihi okunamadı)" };
  return { ok: true, usdTry, asOf, source: "TCMB" };
}

async function fromErApi(): Promise<Rate> {
  const res = await fetchText("https://open.er-api.com/v6/latest/USD");
  if (!res.ok) return { ok: false, reason: `er-api (${res.reason})` };

  let payload: { result?: string; rates?: Record<string, unknown>; time_last_update_unix?: number };
  try {
    payload = JSON.parse(res.body);
  } catch {
    return { ok: false, reason: "er-api (yanıt JSON değil)" };
  }
  if (payload.result && payload.result !== "success") {
    return { ok: false, reason: `er-api (${payload.result})` };
  }

  const usdTry = toNumber(String(payload.rates?.TRY ?? ""));
  if (usdTry === null || usdTry < PLAUSIBLE_MIN || usdTry > PLAUSIBLE_MAX) {
    return { ok: false, reason: "er-api (TRY kuru okunamadı)" };
  }
  const stamp = payload.time_last_update_unix;
  const asOf = typeof stamp === "number" && stamp > 0 ? new Date(stamp * 1000) : new Date();
  return { ok: true, usdTry, asOf, source: "er-api" };
}

/** The current USD/TRY rate, or why there isn't one. Never a guess. */
export async function usdTryRate(): Promise<Rate> {
  const source = await getSetting("fx.source");
  const ttl = cache?.rate.ok ? OK_TTL_MS : FAIL_TTL_MS;
  if (cache && cache.key === source && Date.now() - cache.at < ttl) return cache.rate;

  const rate = source === "erapi" ? await fromErApi() : await fromTcmb();
  cache = { at: Date.now(), key: source, rate };
  return rate;
}

export type Converted =
  | { ok: true; usd: number; usdTry: number; asOf: Date; source: string }
  | { ok: false; reason: string };

export async function tryToUsd(amountTry: number): Promise<Converted> {
  const rate = await usdTryRate();
  if (!rate.ok) return rate;
  return { ok: true, usd: amountTry / rate.usdTry, usdTry: rate.usdTry, asOf: rate.asOf, source: rate.source };
}

export type ConvertedTry =
  | { ok: true; tryAmount: number; usdTry: number; asOf: Date; source: string }
  | { ok: false; reason: string };

export async function usdToTry(amountUsd: number): Promise<ConvertedTry> {
  const rate = await usdTryRate();
  if (!rate.ok) return rate;
  return {
    ok: true,
    tryAmount: amountUsd * rate.usdTry,
    usdTry: rate.usdTry,
    asOf: rate.asOf,
    source: rate.source,
  };
}

/** The one place the "which day's rate was this?" caveat is worded. */
export function rateNote(usdTry: number, asOf: Date, source: string): string {
  return `${source} kuru ${usdTry.toFixed(4)} (${asOf.toLocaleDateString("tr-TR")} tarihli)`;
}

/** For tests and the CLI: drop the memoised rate so the next call refetches. */
export function resetFxCache(): void {
  cache = null;
}
