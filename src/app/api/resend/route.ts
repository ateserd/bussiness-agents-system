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
 * Resend documents for their event webhooks. Confirmed against a real
 * delivered reply: the event type is `email.received`, and `data` carries
 * from/to/subject/email_id but no body at all — `attachments` comes back as
 * an empty array rather than the content being inlined. The body is fetched
 * separately below, by `email_id`, mirroring the GET /emails/:id endpoint
 * Resend documents for sent mail — that part is a best guess, not yet
 * confirmed the same way; it logs its own raw response if it's wrong.
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

/**
 * Confirmed against a real delivered webhook: the email.received event
 * carries only metadata (from/to/subject/message_id/email_id...), no body
 * at all — attachments is an empty array rather than the content being
 * inlined. This fetches the full message by its email_id, mirroring the
 * GET /emails/:id Resend already documents for sent mail. Not yet confirmed
 * this same shape covers received mail — logs its own raw response on a
 * miss, same as the caller does, so a wrong guess here is still one test
 * away from the real field name rather than a dead end.
 */
async function fetchEmailBody(emailId: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.resend.com/emails/${emailId}`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await res.text();
    if (!res.ok) {
      console.warn(`resend inbound: GET /emails/${emailId} failed (${res.status}):`, raw.slice(0, 500));
      return null;
    }
    const body = JSON.parse(raw) as { text?: string; html?: string };
    if (typeof body.text === "string") return body.text;
    if (typeof body.html === "string") return body.html;
    console.warn(`resend inbound: GET /emails/${emailId} had no .text or .html. keys:`, Object.keys(body));
    console.warn(`resend inbound: GET /emails/${emailId} raw:`, raw.slice(0, 2000));
    return null;
  } catch (err) {
    console.warn(`resend inbound: GET /emails/${emailId} threw:`, (err as Error).message);
    return null;
  }
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
  if (!from || !to) return NextResponse.json({ ok: true, ignored: true });

  // Confirmed against a real delivered event: email.received itself carries
  // no body at all, only metadata plus an email_id. Fetch it separately.
  let text: string | null = typeof event.data.text === "string" ? event.data.text : null;
  const emailId = typeof event.data.email_id === "string" ? event.data.email_id : null;
  const apiKey = process.env.RESEND_API_KEY;
  if (!text && emailId && apiKey) {
    text = await fetchEmailBody(emailId, apiKey);
  }
  text ??= "(gövde okunamadı)";

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
