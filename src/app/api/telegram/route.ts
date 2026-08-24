import { NextResponse } from "next/server";
import { executeCommand, parseCommand, COMMAND_HELP } from "@/lib/chat/commands";
import { transcribeVoice } from "@/lib/chat/voice";
import { recordTurn } from "@/lib/chat/history";

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
  const at = new Date();
  let reply: string;
  try {
    reply = await executeCommand(parseCommand(text), { ownerChannel });
  } catch (err) {
    reply = `Komut hata verdi: ${(err as Error).message}`;
  }
  await recordTurn("user", text, "telegram", at);
  await recordTurn("assistant", reply, "telegram", new Date(at.getTime() + 1));
  return deliver(chatId, reply);
}

async function deliver(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, text });

  // Telegram rejects an empty message with a 400, and this used to post one and
  // throw the rejection away — the owner saw nothing at all, with no error
  // anywhere to explain it. `runAgent` no longer returns an empty summary; this
  // is the backstop for every other caller.
  const body = text.trim() || "(boş cevap üretildi — bir şey ters gitti, tekrar sorar mısın?)";

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: body, parse_mode: undefined }),
  });
  if (!res.ok) {
    // Loud, because a delivery that fails silently is indistinguishable from a
    // system that never ran.
    console.warn(`· telegram gönderimi başarısız (${res.status}): ${await res.text().catch(() => "")}`);
  }
  return NextResponse.json({ ok: res.ok, text: body });
}

export async function GET() {
  return NextResponse.json({
    status: process.env.TELEGRAM_BOT_TOKEN ? "configured" : "not_configured",
    voice: process.env.OPENAI_API_KEY ? "configured" : "not_configured",
    commands: COMMAND_HELP.split("\n"),
  });
}
