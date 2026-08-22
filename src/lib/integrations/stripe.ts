/**
 * Month-to-date revenue, read from Stripe (§5).
 *
 * Plain `fetch` rather than the `stripe` package: one read-only endpoint does
 * not justify a dependency, and the rest of this system already talks to
 * external APIs this way.
 *
 * Every branch of this file that cannot produce a number returns `ok: false`
 * with a reason, which the ledger renders as `⚠️ … kullanılamıyor`. Two cases
 * deserve naming, because both would otherwise produce a plausible wrong
 * number rather than an obvious gap:
 *
 *   - **Mixed currencies.** Charges in TRY and USD cannot be added. Summing
 *     them would report a number that is wrong in whichever unit you read it.
 *   - **Truncated pagination.** More charges than the page cap means the total
 *     is an undercount. An undercount of revenue reads as a bad month rather
 *     than as a broken integration, so it is refused instead.
 *
 * Branch attribution comes from `metadata.branch` on the charge (`web` or
 * `automation`). The two branches keep separate P&Ls, so an untagged charge is
 * reported as untagged rather than guessed into one of them.
 */

const API = "https://api.stripe.com/v1/charges";
const PAGE_SIZE = 100;
/** 10 pages = 1000 charges in one month. Past that, refuse rather than undercount. */
const MAX_PAGES = 10;
const TIMEOUT_MS = 15_000;

/** Currencies Stripe holds without decimals — dividing these by 100 would be wrong. */
const ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
  "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

export type Branch = "web" | "automation";

export type StripeRevenue =
  | {
      ok: true;
      currency: string;
      total: number;
      byBranch: Record<Branch, number>;
      /** Charges with no `metadata.branch` — counted, never split by guess. */
      untagged: number;
    }
  | { ok: false; reason: string };

type Charge = {
  id: string;
  paid?: boolean;
  refunded?: boolean;
  status?: string;
  amount?: number;
  amount_refunded?: number;
  currency?: string;
  metadata?: Record<string, string>;
};

function toMajorUnits(minor: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? minor : minor / 100;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export async function fetchRevenueMtd(since: Date): Promise<StripeRevenue> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, reason: "STRIPE_SECRET_KEY tanımlı değil" };

  const charges: Charge[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      "created[gte]": String(Math.floor(since.getTime() / 1000)),
    });
    if (startingAfter) params.set("starting_after", startingAfter);

    let body: { data?: Charge[]; has_more?: boolean; error?: { message?: string } };
    try {
      const res = await fetch(`${API}?${params}`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      body = await res.json();
      if (!res.ok) {
        return { ok: false, reason: body.error?.message ?? `Stripe ${res.status}` };
      }
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }

    const batch = body.data ?? [];
    charges.push(...batch);

    if (!body.has_more || batch.length === 0) break;
    startingAfter = batch[batch.length - 1].id;

    if (page === MAX_PAGES - 1) {
      return {
        ok: false,
        reason: `bu ay ${MAX_PAGES * PAGE_SIZE}+ tahsilat var, sayfalama yetmedi — eksik toplam raporlanmaz`,
      };
    }
  }

  const settled = charges.filter((c) => c.paid && c.status === "succeeded" && !c.refunded);

  const currencies = new Set(settled.map((c) => c.currency?.toLowerCase()).filter(Boolean));
  if (currencies.size > 1) {
    return {
      ok: false,
      reason: `birden fazla para birimi (${[...currencies].join(", ").toUpperCase()}) — toplanamaz`,
    };
  }

  const currency = ([...currencies][0] ?? "usd").toUpperCase();
  const byBranch: Record<Branch, number> = { web: 0, automation: 0 };
  let untagged = 0;
  let total = 0;

  for (const c of settled) {
    const net = (c.amount ?? 0) - (c.amount_refunded ?? 0);
    if (net <= 0) continue;
    const amount = toMajorUnits(net, currency);
    total += amount;

    const branch = c.metadata?.branch?.toLowerCase();
    if (branch === "web" || branch === "automation") byBranch[branch] += amount;
    else untagged += amount;
  }

  return { ok: true, currency, total, byBranch, untagged };
}
