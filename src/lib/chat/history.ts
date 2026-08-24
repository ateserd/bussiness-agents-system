import { randomUUID } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { conversations, type ChatRole } from "@/db/schema";
import { getSetting } from "@/lib/settings";

/**
 * What was said on Telegram, so the manager can see the conversation it is in.
 *
 * Every message used to build a fresh single-message run. The manager therefore
 * could not read its own previous reply, and it showed: it answered "yapsın"
 * with "who should do what?" one turn after saying what it had just done, and
 * two messages later denied having done it. No amount of prompt work fixes
 * that — there was nothing to remember with.
 *
 * Both halves are recorded, including slash commands and their output, because
 * "/pause scout" followed by "geri al" is the same conversation as any other.
 *
 * Two bounds, both settings rather than constants: how many turns to replay and
 * how far back to look. A count alone would drag this morning's exchange into
 * tonight's unrelated question; a window alone would replay forty messages from
 * a busy hour. The owner can widen either by saying so.
 */

/**
 * Assistant turns are clipped. The brief runs to a couple of thousand
 * characters and replaying it whole would cost more than it is worth — the
 * manager needs to know what it said, not to re-read every figure. The owner's
 * own words are never clipped: they are short, and they are the record of what
 * he actually asked for.
 */
const ASSISTANT_CLIP = 1200;

export type Turn = { role: ChatRole; content: string };

export async function recordTurn(
  role: ChatRole,
  content: string,
  channel = "telegram",
  /** Pinned by the caller so a question and its answer cannot tie and reorder. */
  at = new Date(),
): Promise<void> {
  const text = content.trim();
  if (!text) return;
  try {
    const db = await getDb();
    await db.insert(conversations).values({
      id: randomUUID(),
      channel,
      role,
      content: role === "assistant" ? text.slice(0, ASSISTANT_CLIP) : text.slice(0, 4000),
      createdAt: at,
    });
  } catch {
    // Losing a line of history must never cost the owner his reply. The next
    // turn simply has one less message of context.
  }
}

/**
 * The conversation so far, oldest first, ready to prepend to a run's messages.
 *
 * Returns nothing rather than throwing: a manager with no history is the old
 * behaviour, which worked. A manager whose reply failed because a history query
 * did is a regression.
 */
export async function recentTurns(now = new Date(), channel = "telegram"): Promise<Turn[]> {
  try {
    const [turns, hours] = await Promise.all([
      getSetting("chat.history_turns"),
      getSetting("chat.history_hours"),
    ]);
    if (turns <= 0) return [];

    const db = await getDb();
    const since = new Date(now.getTime() - hours * 60 * 60 * 1000);
    const rows = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.channel, channel), gt(conversations.createdAt, since)))
      .orderBy(desc(conversations.createdAt))
      .limit(turns);

    const ordered = rows.reverse().map((r) => ({ role: r.role, content: r.content }));

    // The API requires the first message to be from the user. A window that
    // happens to open on an assistant turn — the owner's question fell outside
    // it — would otherwise fail the whole request.
    while (ordered.length > 0 && ordered[0].role === "assistant") ordered.shift();
    return ordered;
  } catch {
    return [];
  }
}

/**
 * Drop everything on this channel. The owner's "unut" / "sıfırla" escape hatch,
 * for when a conversation has gone somewhere he does not want carried forward.
 */
export async function forgetHistory(channel = "telegram"): Promise<number> {
  const db = await getDb();
  const rows = await db.delete(conversations).where(eq(conversations.channel, channel)).returning();
  return rows.length;
}
