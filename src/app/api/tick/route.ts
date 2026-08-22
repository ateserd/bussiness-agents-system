import { NextResponse } from "next/server";
import { allCadences } from "@/lib/scheduler/cadences";
import { tick, type TickResult } from "@/lib/scheduler/tick";

/**
 * Scheduler endpoint — the §7 cadence table's clock (§7).
 *
 * `tick()` already does the hard part: it is idempotent per agent per cadence
 * per minute, so any scheduler may call this, twice if it likes. This route is
 * only the doorway.
 *
 * Protected like the Telegram webhook: without `CRON_SECRET` it refuses to run
 * rather than exposing agent execution to the open internet. Running agents
 * costs money and, for ungated ones, reaches outside — an open endpoint here
 * would be the widest hole in the system.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on its own; a plain
 * server cron can send `x-cron-secret` instead.
 *
 * NOTE ON SERVERLESS: `tick()` runs due agents sequentially, each with a 120s
 * timeout and two retries. At 17:00 eight leads come due at once, which can
 * outlast any serverless limit. For a real deployment prefer a server cron
 * calling `npm run tick`; the Vercel path suits light cadences.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Minutes to replay, ending at now.
 *
 * `cronMatches` compares the current minute exactly, so a cron that fires even
 * one minute late would silently skip everything due. Replaying a short window
 * closes that gap; the idempotency key makes every replayed minute a no-op if
 * it already ran. The default matches the recommended quarter-hour cron.
 */
const DEFAULT_WINDOW_MIN = 15;
const MAX_WINDOW_MIN = 60;

function authorize(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Zamanlayıcı bağlı değil — CRON_SECRET gerekiyor (bkz. SETUP_TODO.md §7)." },
      { status: 503 },
    );
  }
  const bearer = req.headers.get("authorization");
  const header = req.headers.get("x-cron-secret");
  if (bearer !== `Bearer ${secret}` && header !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return null;
}

async function handle(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;

  const params = new URL(req.url).searchParams;

  // Same preview `npm run tick -- --plan` gives, for checking a deployment
  // without spending anything.
  if (params.get("plan")) {
    const rows = allCadences().sort((a, b) => a.cron.localeCompare(b.cron));
    return NextResponse.json({
      ok: true,
      planned: rows.length,
      runs: rows.map((r) => ({ cron: r.cron, agentId: r.agentId, label: r.label })),
    });
  }

  const requested = Number(params.get("window") ?? DEFAULT_WINDOW_MIN);
  const window = Number.isFinite(requested)
    ? Math.min(MAX_WINDOW_MIN, Math.max(1, Math.trunc(requested)))
    : DEFAULT_WINDOW_MIN;

  const now = new Date();
  const total: TickResult = { due: 0, ran: 0, skipped: 0, failed: 0, details: [] };

  // Oldest minute first, so a run that was merely late still happens in order.
  for (let back = window - 1; back >= 0; back--) {
    const at = new Date(now.getTime() - back * 60_000);
    const result = await tick(at);
    total.due += result.due;
    total.ran += result.ran;
    total.skipped += result.skipped;
    total.failed += result.failed;
    total.details.push(...result.details);
  }

  return NextResponse.json({
    ok: total.failed === 0,
    at: now.toISOString(),
    windowMinutes: window,
    ...total,
  });
}

/** Vercel Cron issues GET. */
export async function GET(req: Request) {
  return handle(req);
}

/** Everything else — curl, Inngest, a server cron — tends to POST. */
export async function POST(req: Request) {
  return handle(req);
}
