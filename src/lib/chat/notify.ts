/**
 * Pushes a message to the owner's phone (§6).
 *
 * The approval table is pull-based: a card sits there until someone opens the
 * dashboard. For anything that would reach a client, that is the wrong shape —
 * the owner asked to be *asked*, on every contact, not to remember to check.
 * So `requireApproval` calls this.
 *
 * Never throws. A notification that fails must not fail the approval it is
 * announcing: the card is already written, and losing the run would be worse
 * than losing the ping. Failures are logged and swallowed.
 */

const API = "https://api.telegram.org";
const TIMEOUT_MS = 8_000;

export function notifyConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export async function notifyOwner(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;

  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`· telegram bildirimi başarısız (${res.status})`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`· telegram bildirimi başarısız (${(err as Error).message})`);
    return false;
  }
}

/** Telegram rejects messages over 4096 characters. */
export function clip(text: string, max = 900): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
