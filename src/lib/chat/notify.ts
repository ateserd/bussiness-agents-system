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

/** Under Telegram's 4096, with room for the part marker appended below. */
const CHUNK = 3900;

/**
 * Splits on blank lines, so a message never breaks mid-section.
 *
 * A section longer than one chunk on its own is split on line boundaries
 * rather than mid-word; only a single line longer than a whole chunk is cut,
 * and that cannot happen with anything this codebase writes.
 */
export function splitLong(text: string, limit = CHUNK): string[] {
  if (text.length <= limit) return [text];

  const parts: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) parts.push(current.trimEnd());
    current = "";
  };

  for (const block of text.split("\n\n")) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    push();
    if (block.length <= limit) {
      current = block;
      continue;
    }
    // One section is bigger than a whole message; fall back to line breaks.
    for (const line of block.split("\n")) {
      const next = current ? `${current}\n${line}` : line;
      if (next.length <= limit) current = next;
      else {
        push();
        current = line.length <= limit ? line : line.slice(0, limit);
      }
    }
  }
  push();
  return parts;
}

/**
 * A message too long for one Telegram send, delivered whole.
 *
 * The owner asked for the full brief — every active project, every quiet
 * client, every open deal — which can outgrow 4096 characters. Truncating it
 * would answer a request for completeness with an ellipsis, so it is split
 * instead, and each part says which it is so a missing one is visible.
 */
export async function sendLong(text: string): Promise<boolean> {
  const parts = splitLong(text);
  if (parts.length === 1) return notifyOwner(parts[0]);

  let allOk = true;
  for (const [i, part] of parts.entries()) {
    const ok = await notifyOwner(`${part}\n\n— ${i + 1}/${parts.length} —`);
    if (!ok) allOk = false;
  }
  return allOk;
}
