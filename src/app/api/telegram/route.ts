import { NextResponse } from "next/server";
import { executeCommand, parseCommand, COMMAND_HELP } from "@/lib/chat/commands";

/**
 * Telegram webhook — the phone-side command line (§6).
 *
 * SCAFFOLD. The command handling below is real and shared with `npm run brief`;
 * what is missing is a bot token, so nothing is ever sent back to Telegram.
 * Wiring it up is: set TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET, point the
 * bot at this route, and replace `deliver()`. See SETUP_TODO.md → "Telefonunu
 * açar".
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
    message?: { text?: string; chat?: { id?: number | string }; voice?: unknown };
  };

  const chatId = String(update.message?.chat?.id ?? "");
  const allowed = process.env.TELEGRAM_CHAT_ID;
  if (allowed && chatId !== allowed) {
    // Only the owner commands this system.
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (update.message?.voice) {
    return deliver(chatId, "⚠️ Sesli not transkripsiyonu henüz bağlı değil (bkz. SETUP_TODO.md).");
  }

  const text = update.message?.text?.trim();
  if (!text) return NextResponse.json({ ok: true });
  if (text === "/help" || text === "/start") return deliver(chatId, COMMAND_HELP);

  try {
    const reply = await executeCommand(parseCommand(text));
    return deliver(chatId, reply);
  } catch (err) {
    return deliver(chatId, `Komut hata verdi: ${(err as Error).message}`);
  }
}

/** Replace this with a real sendMessage call once the bot token exists. */
async function deliver(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, text });

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: undefined }),
  });
  return NextResponse.json({ ok: res.ok, text });
}

export async function GET() {
  return NextResponse.json({
    status: process.env.TELEGRAM_BOT_TOKEN ? "configured" : "not_configured",
    commands: COMMAND_HELP.split("\n"),
  });
}
