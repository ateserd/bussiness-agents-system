import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { leads } from "@/db/schema";
import { writeMemory } from "@/lib/brain/write";
import { clip, notifyOwner } from "@/lib/chat/notify";

/**
 * Inbound email — a reply to a cold outreach message lands here (§8).
 *
 * Resend's "Enable receiving" on a verified domain routes incoming mail to
 * whatever webhook URL you set in its dashboard; this is that URL. It never
 * sends a reply back — the owner's standing rule is that agents draft and
 * the owner sends, and a reply is not a draft. This route only surfaces:
 * into the Brain (client-scoped, so an agent has it as context on its next
 * run) and onto Telegram (so the owner sees it without opening the panel).
 *
 * Signed like every other Resend webhook — Svix underneath, same scheme
 * Resend documents for their event webhooks. The event type is confirmed
 * as `email.received` (Ateş's own Resend dashboard, not just the docs); the
 * field names read below (`data.from` / `data.to` / `data.subject` /
 * `data.text`) are still the documented shape, not yet confirmed against an
 * actual delivered payload — if the parsed fields come back empty once a
 * real reply arrives, log the raw body and adjust the field names here.
 */

const TIMESTAMP_TOLERANCE_SEC = 300;

function verifySignature(payload: string, headers: Headers, secret: string): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TIMESTAMP_TOLERANCE_SEC) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", secretBytes)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  // svix-signature carries space-separated "v1,<base64>" tokens; only v1 is
  // in active use, but checking every token costs nothing.
  return signature.split(" ").some((token) => {
    const sig = token.split(",")[1];
    if (!sig) return false;
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
}

/** Resend's from/to fields may be a plain address, an array, or `{ email }`. */
function extractAddress(value: unknown): string | null {
  if (typeof value === "string") return value.toLowerCase();
  if (Array.isArray(value)) return extractAddress(value[0]);
  if (value && typeof value === "object" && "email" in value) {
    return extractAddress((value as { email: unknown }).email);
  }
  return null;
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Gelen e-posta bağlı değil — RESEND_WEBHOOK_SECRET gerekiyor (bkz. SETUP_TODO.md §8)." },
      { status: 503 },
    );
  }

  const raw = await req.text();
  if (!verifySignature(raw, req.headers, secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // The webhook is subscribed to email.received specifically, but Resend
  // will happily deliver whatever else gets added to that same endpoint
  // later (bounces, opens...). Their payloads don't carry a reply, so
  // treating them as one would write a false "X yanıt verdi" into the Brain.
  if (event.type !== "email.received" || !event.data) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const from = extractAddress(event.data.from);
  const to = extractAddress(event.data.to);
  const subject = typeof event.data.subject === "string" ? event.data.subject : "(konu yok)";
  const text = typeof event.data.text === "string" ? event.data.text : "(gövde okunamadı)";
  if (!from || !to) return NextResponse.json({ ok: true, ignored: true });

  const branch =
    to === process.env.RESEND_FROM_WEB?.toLowerCase()
      ? "web"
      : to === process.env.RESEND_FROM_AUTOMATION?.toLowerCase()
        ? "automation"
        : null;

  const db = await getDb();
  const [lead] = branch ? await db.select().from(leads).where(eq(leads.email, from)) : [];
  const label = lead?.company ?? from;

  // Only write to the Brain when the branch is known — an unmatched `to`
  // means we cannot pick a safe scope, and a wrong scope is worse than a
  // missed one (§ scope isolation is enforced at this one write path).
  if (branch) {
    const body = text.trim().slice(0, 480);
    await writeMemory({
      kind: "client_context",
      scopes: lead ? [`branch.${branch}`, `client.${lead.id}`] : [`branch.${branch}`, `dept.${branch}.outreach`],
      content: `${label} yanıt verdi: "${body}"`.slice(0, 600),
      confidence: 0.9,
    });
  }

  await notifyOwner(`📧 ${label} yanıt verdi (${subject})\n\n${clip(text, 700)}`);

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({
    status: process.env.RESEND_WEBHOOK_SECRET ? "configured" : "not_configured",
  });
}
