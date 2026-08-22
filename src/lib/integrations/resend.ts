/**
 * Cold email delivery through Resend (§8).
 *
 * This is the delivery half only. The approval gate is `outreach_send` in
 * tools.ts, and it is unconditional — nothing here runs before the owner
 * taps approve on the phone. Only the "email" channel dispatches from here;
 * outreach_send accepts other channels too (Instagram DM, etc.), but no
 * provider is wired for them, so those still land approved and stay manual.
 */

const SEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;

export type SendResult = { ok: true; id: string } | { ok: false; reason: string };

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * The address a branch sends from — two separate env vars, not one shared
 * default. The branches are separate businesses on separate domains; a
 * missing address should fail that branch's mail rather than silently borrow
 * the other branch's identity.
 */
export function fromAddressFor(branch: "web" | "automation" | "shared"): string | null {
  if (branch === "web") return process.env.RESEND_FROM_WEB ?? null;
  if (branch === "automation") return process.env.RESEND_FROM_AUTOMATION ?? null;
  return null;
}

export async function sendEmail(options: {
  branch: "web" | "automation" | "shared";
  to: string;
  subject: string;
  text: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, reason: "RESEND_API_KEY tanımlı değil" };

  const from = fromAddressFor(options.branch);
  if (!from) {
    return {
      ok: false,
      reason:
        options.branch === "web"
          ? "RESEND_FROM_WEB tanımlı değil"
          : options.branch === "automation"
            ? "RESEND_FROM_AUTOMATION tanımlı değil"
            : `${options.branch} şubesi için gönderim adresi yok`,
    };
  }

  let res: Response;
  let raw: string;
  try {
    res = await fetch(SEND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        from,
        to: options.to,
        subject: options.subject,
        text: options.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    raw = await res.text();
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  // A network intermediary (proxy, firewall) between here and Resend can
  // return an HTML or plain-text error page instead of Resend's own JSON —
  // parsed separately so that case reads as a clean status code, not a raw
  // JS parse error.
  let body: { id?: string; message?: string };
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return { ok: false, reason: `Resend'den beklenmeyen yanıt (durum ${res.status})` };
  }

  if (!res.ok) return { ok: false, reason: body.message ?? `Resend ${res.status}` };
  if (!body.id) return { ok: false, reason: "Resend id döndürmedi" };
  return { ok: true, id: body.id };
}
