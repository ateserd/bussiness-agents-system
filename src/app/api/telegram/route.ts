import { NextResponse } from "next/server";
import { executeCommand, parseCommand, COMMAND_HELP } from "@/lib/chat/commands";
import { transcribeVoice } from "@/lib/chat/voice";
import { recordTurn } from "@/lib/chat/history";
import { splitLong } from "@/lib/chat/notify";

/**
 * Telegram webhook — the phone-side command line (§6).
 *
 * Complete: command handling is shared with `npm run brief`, and `deliver()`
 * calls the real sendMessage. All that is missing is the tokens — set
 * TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET and point the bot here. See
 * SETUP_TODO.md → "Telefonun".
 *
 * Voice notes are transcribed and then run as if typed; without
 * OPENAI_API_KEY that path reports the gap instead of ignoring the message.
 *
 * Incoming update bodies are attacker-controlled: the secret header is checked
 * before anything is parsed, and the chat id is pinned to the owner's.
 */

export async function POST(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!token || !secret) {
    return NextResponse.json(
      { ok: false, error: "Telegram bağlı değil — TELEGRAM_BOT_TOKEN ve TELEGRAM_WEBHOOK_SECRET gerekiyor." },
      { status: 503 },
    );
  }

  if (req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await req.json()) as {
    update_id?: number;
    message?: {
      text?: string;
      chat?: { id?: number | string };
      voice?: { file_id?: string; duration?: number };
    };
  };

  const chatId = String(update.message?.chat?.id ?? "");
  const allowed = process.env.TELEGRAM_CHAT_ID;
  if (allowed && chatId !== allowed) {
    // Only the owner commands this system.
    return NextResponse.json({ ok: true, ignored: true });
  }
  // Proof of identity, not merely of the shared secret. When TELEGRAM_CHAT_ID
  // is unset the secret alone lets anyone in, so this stays false and the
  // settings tools are not mounted — an unpinned bot can talk, not reconfigure.
  const ownerChannel = Boolean(allowed) && chatId === allowed;

  let text = update.message?.text?.trim();

  // A voice note is an instruction, not information — the Brain says so. Turn
  // it into text and let it fall through to the same parser a typed message
  // uses, so there is one command path rather than two.
  const voice = update.message?.voice;
  if (voice?.file_id) {
    const heard = await transcribeVoice({
      fileId: voice.file_id,
      botToken: token,
      durationSec: voice.duration,
    });
    if (!heard.ok) {
      return deliver(chatId, `⚠️ Sesli not çözümlenemedi (${heard.reason}).`);
    }
    // Echo it back: a misheard command should be visible, not silently run.
    await deliver(chatId, `🎤 “${heard.text}”`);
    text = heard.text;
  }

  if (!text) return NextResponse.json({ ok: true });
  if (text === "/help" || text === "/start") return deliver(chatId, COMMAND_HELP);

  // Both halves of the exchange are recorded here, after the command has run,
  // so the message being handled never appears in its own history. Slash
  // commands are recorded too: "/pause scout" followed by "geri al" is one
  // conversation, and the second half is unanswerable without the first.
  //
  // Recording is best-effort and deliberately not awaited into the reply path
  // beyond this point — the owner gets his answer whether or not it is kept.
  // Telegram redelivers an update whose webhook did not answer quickly, and a
  // model turn can outlast that. Without this, one message becomes two runs:
  // billed twice, and — worse — two approval cards for the same draft.
  if (!claimUpdate(update.update_id)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const at = new Date();
  let reply: string;
  try {
    // A hung provider used to hang the webhook with it. The ceiling is well
    // past a normal turn, and a run that passes it is reported rather than
    // waited on — the model may still finish and write its own activity row,
    // but the owner is no longer left staring at a sent message.
    reply = await withTimeout(
      executeCommand(parseCommand(text), { ownerChannel }),
      REPLY_TIMEOUT_MS,
      "Cevap zamanında gelmedi — model yanıt vermedi. Tekrar sorar mısın?",
    );
  } catch (err) {
    reply = `Komut hata verdi: ${(err as Error).message}`;
  }
  await recordTurn("user", text, "telegram", at);
  await recordTurn("assistant", reply, "telegram", new Date(at.getTime() + 1));
  return deliver(chatId, reply);
}

const REPLY_TIMEOUT_MS = 110_000;

/**
 * Resolve to a fallback rather than reject, so a slow turn still answers.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((err) => {
        clearTimeout(timer);
        resolve(`Komut hata verdi: ${(err as Error).message}` as T);
      });
  });
}

/**
 * Remember which updates have been handled, in memory and bounded.
 *
 * A restart forgets them, which is the right trade: the window that matters is
 * the seconds during which Telegram retries, and paying a database round trip
 * on every message to survive a restart buys nothing.
 */
const SEEN_LIMIT = 500;
const seen = new Set<number>();

function claimUpdate(id: number | undefined): boolean {
  if (typeof id !== "number") return true; // no id to dedupe on — let it through
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > SEEN_LIMIT) {
    // Oldest first: insertion order is iteration order for a Set.
    for (const old of seen) {
      seen.delete(old);
      if (seen.size <= SEEN_LIMIT) break;
    }
  }
  return true;
}

async function deliver(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, text });

  // Telegram rejects an empty message with a 400, and this used to post one and
  // throw the rejection away — the owner saw nothing at all, with no error
  // anywhere to explain it. `runAgent` no longer returns an empty summary; this
  // is the backstop for every other caller.
  const body = text.trim() || "(boş cevap üretildi — bir şey ters gitti, tekrar sorar mısın?)";

  // Telegram rejects anything over 4096 characters, and this path used to post
  // the whole thing and lose it. `/brief` is the guaranteed case: the brief was
  // designed to list every project, client and deal, and `sendLong` was written
  // for exactly that — but only the *push* path used it, so the same text
  // requested by hand died at the wall. Cutting it would be the wrong fix: a
  // truncated brief is a wrong answer to someone who asked for the full one.
  const parts = splitLong(body);
  let allOk = true;
  for (const [i, part] of parts.entries()) {
    const chunk = parts.length > 1 ? `${part}\n\n— ${i + 1}/${parts.length} —` : part;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: undefined }),
    });
    if (!res.ok) {
      allOk = false;
      // Loud, because a delivery that fails silently is indistinguishable from
      // a system that never ran.
      console.warn(`· telegram gönderimi başarısız (${res.status}): ${await res.text().catch(() => "")}`);
    }
  }
  return NextResponse.json({ ok: allOk, text: body });
}

export async function GET() {
  return NextResponse.json({
    status: process.env.TELEGRAM_BOT_TOKEN ? "configured" : "not_configured",
    voice: process.env.OPENAI_API_KEY ? "configured" : "not_configured",
    commands: COMMAND_HELP.split("\n"),
  });
}
