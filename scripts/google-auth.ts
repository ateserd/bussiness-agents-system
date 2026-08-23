import http from "node:http";
import readline from "node:readline";
import { AddressInfo } from "node:net";

/**
 * One-shot: turn a Google OAuth client into a refresh token.
 *
 * Run once, paste three lines into `.env`, never think about it again. The
 * token it prints does not expire on its own — the runtime exchanges it for a
 * short-lived access token on every call — so this script is not part of any
 * loop and deliberately lives outside the app.
 *
 * It handles both places it will realistically be run. On a laptop the loopback
 * listener catches the redirect and finishes by itself. On a headless VPS
 * nothing can open a browser and `http://localhost:PORT/...` will fail to load
 * in the browser you *do* have — so it also accepts the failed URL (or just the
 * code out of it) pasted back on stdin, and takes whichever arrives first.
 *
 * Google removed the out-of-band redirect in 2022, which is why the loopback
 * one is used even in the paste case; a "Desktop app" client accepts
 * http://localhost on any port without registering it.
 */

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Bağlandı</title>
<body style="font-family:system-ui;background:#0b1210;color:#e8f0ee;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1 style="font-weight:600">Bağlandı</h1>
<p style="color:#8ea3bd">Terminale dönebilirsin.</p></div>`;

/** The code out of a full redirect URL, or the code itself if that is what was pasted. */
function extractCode(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const code = new URL(raw).searchParams.get("code");
    if (code) return code;
  } catch {
    // Not a URL — fall through and treat it as the code.
  }
  return raw.includes("://") ? null : raw;
}

function listenForCode(): Promise<{ port: number; code: Promise<string> }> {
  return new Promise((resolve, reject) => {
    let settle: (code: string) => void;
    const code = new Promise<string>((r) => {
      settle = r;
    });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const got = url.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(DONE_PAGE);
      if (got) {
        settle(got);
        server.close();
      }
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({ port: (server.address() as AddressInfo).port, code });
    });
  });
}

function askOnStdin(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("\nYa da adres çubuğundaki URL'yi (veya sadece code=... değerini) buraya yapıştır: ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      [
        "GOOGLE_CLIENT_ID ve GOOGLE_CLIENT_SECRET gerekli.",
        "",
        "Google Cloud Console → Credentials → Create OAuth client ID → Desktop app,",
        "sonra ikisini .env'e yaz ve bu komutu tekrar çalıştır.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const { port, code: fromBrowser } = await listenForCode();
  const redirectUri = `http://localhost:${port}`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    // offline + consent together are what make Google hand back a *refresh*
    // token. Without prompt=consent a second run for the same client returns
    // only an access token and the script would look broken.
    access_type: "offline",
    prompt: "consent",
  });

  console.log("\nBu adresi tarayıcıda aç ve kendi Google hesabınla izin ver:\n");
  console.log(`  ${AUTH}?${params}\n`);
  console.log("İzin verdikten sonra tarayıcı localhost'a yönlenecek.");
  console.log("Sunucuda çalıştırıyorsan o sayfa açılmayacak — bu normal.");

  const code = await Promise.race([fromBrowser, askOnStdin().then((raw) => extractCode(raw) ?? "")]);
  if (!code) {
    console.error("\nKod alınamadı. Baştan dene.");
    process.exit(1);
  }

  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = (await res.json()) as { refresh_token?: string; error_description?: string; error?: string };

  if (!res.ok || !body.refresh_token) {
    console.error(`\nToken alınamadı: ${body.error_description ?? body.error ?? res.status}`);
    console.error("En sık sebep: kod bir kez kullanılabilir ve kısa ömürlüdür. Baştan dene.");
    process.exit(1);
  }

  console.log("\n" + "─".repeat(64));
  console.log("Bunu .env'e ekle:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${body.refresh_token}`);
  console.log("\nTakvimin birincil takvim değilse onu da ekle (Google Takvim → ayarlar → Takvim kimliği):");
  console.log("# GOOGLE_CALENDAR_ID=...");
  console.log("─".repeat(64));
  console.log("\nSonra sunucuyu yeniden başlat. Bu komutu bir daha çalıştırman gerekmiyor.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
