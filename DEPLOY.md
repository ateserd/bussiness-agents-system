# Deploying Mission Control

Everything else in this repo assumes a laptop: PGlite, `npm run dev`, no
network. This document is the other half — putting it on a box that stays up
when the laptop is closed, with a real database two processes can share.

## Why not Vercel

`vercel.json` and `/api/tick` are still in the repo and still work for light
load. They are not the recommended path, and the reason is concrete: at
15:15 on weekdays, eight department-lead agents come due in the same minute.
`tick()` runs due agents sequentially — each with a 120s timeout and two
retries — so that single cron invocation can run well past Vercel's request
limit. A server with its own cron has no such ceiling; it just runs
`npm run tick` for as long as it takes. Everything below sets that up.

## Shape of the deployment

```
Supabase (Postgres)  <──  Mission Control on a VPS  <──  Caddy (TLS)  <── you / Telegram
                              │
                              └── systemd timer, every 15 min → npm run tick
```

- **Database:** Supabase, not PGlite. PGlite runs in-process against a local
  file — two processes (the app and a cron) can't share it. `DATABASE_URL`
  is the only thing that changes; schema and migrations are identical.
- **App:** `next start`, kept alive by systemd, not a serverless function.
- **Scheduler:** a systemd timer calling `npm run tick` directly — the
  server-cron path the README already recommends, no HTTP layer, no
  `CRON_SECRET` needed for it to work (you can still set one if you also
  want `/api/tick` reachable for manual checks).
- **TLS / public entry:** Caddy, because Telegram's webhook requires public
  HTTPS and Caddy gets a certificate with zero manual steps.

## 1. Supabase

Create a project at supabase.com (the free tier is enough at this scale).
Settings → Database → Connection string → **Session pooler** — not
`db.<ref>.supabase.co`, which is IPv6-only and will fail to connect from
most VPS providers.

```
DATABASE_URL=postgresql://postgres.xxxx:PASSWORD@aws-0-xxxx.pooler.supabase.com:5432/postgres
```

## 2. The VPS

Any KVM-virtualized box works — the app is a few hundred MB of RAM, Next.js
plus a systemd timer. Point a domain's A record at the box's IP now; Caddy
needs that to resolve before it can request a certificate — a bare IP
cannot get one, and the Telegram webhook requires valid HTTPS, so this
isn't optional. No domain yet? [sslip.io](https://sslip.io) resolves
`anything.<ip-with-dashes>.sslip.io` to that IP with no DNS setup at all,
and Caddy can get a real Let's Encrypt certificate for it since it's a
real, resolvable name. Use that everywhere a domain is asked for below,
then switch to a real domain later by changing one line in the Caddyfile.

Already pointing this domain at another VPS for something else — n8n, say,
where OAuth redirect URIs are registered against its exact hostname? Don't
touch that record. A domain isn't bound to one IP; every subdomain is its
own independent DNS record. Add a new one just for this app, e.g.
`mission.yourdomain.com` → this VPS's IP, and leave whatever record n8n
uses exactly as it is. Caddy requests its own certificate for the new
subdomain — nothing about that touches the other server's certificate or
its OAuth callbacks.

```bash
ssh root@your-vps-ip
apt update && apt upgrade -y
apt install -y curl git

# Only 22 (SSH), 80 and 443 (Caddy) need to be reachable — the app itself
# binds localhost:3000 and is never exposed directly.
apt install -y ufw
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable

# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

useradd --system --home /opt/mission-control --shell /usr/sbin/nologin missioncontrol
```

## 3. The app

```bash
git clone <your-repo-url> /opt/mission-control
cd /opt/mission-control
npm install
cp .env.example .env
```

Fill in `.env`. At minimum for a live deployment:

| Key | Why it's not optional here |
|---|---|
| `DATABASE_URL` | The Supabase connection string from step 1 |
| `ANTHROPIC_API_KEY` | Without it every agent stays in simulate mode forever |
| `TELEGRAM_BOT_TOKEN` / `_CHAT_ID` / `_WEBHOOK_SECRET` | Approvals and the brief reach your phone through this |

Everything else in `.env.example` (Places, PageSpeed, Resend, the calendar
feed, `CRON_SECRET`) stays optional exactly as documented there — an agent
whose key is missing reports `⚠️ kaynak kullanılamıyor`, it doesn't fail
silently or invent a number.

`db:push` and `db:seed:fresh` read `process.env` directly — unlike the
systemd services below (which get `.env` via `EnvironmentFile=`), a plain
shell doesn't load it for you. Export it for this session first, or these
run silently against a throwaway local PGlite database instead of Supabase,
and the app then fails at "relation does not exist" once it starts for real
against the actual empty Supabase database:

```bash
set -a; source .env; set +a
```

```bash
npm run build
npm run db:push       # creates the schema on the Supabase database
npm run db:seed:fresh # agents + every business fact Ateş actually decided —
                       # no fake leads, deals, clients or activity history
```

`db:push` prints `· driver: postgres-js` when it found `DATABASE_URL`; it
prints `· driver: pglite` — and happily reports migrations "applied" against
an empty local database — when it didn't. That line is the only visible
difference between the two, since the rest of the output reads the same
either way.

Use `db:seed:fresh`, not `db:seed`, on a real database. The default seed is
demo texture for a local checkout — a believable month of fabricated leads,
deals and activity so the dashboard looks alive on `npm run dev`. On the
database the LEDGER actually reads from, that texture would show up as real
revenue. `--fresh` writes only the agents and the standing decisions
(ICP A/B, the control rules, the 14-day stale threshold) that agents' prompts
depend on at run time — everything else starts empty and fills in from what
actually happens.

## 4. systemd

```bash
chown -R missioncontrol:missioncontrol /opt/mission-control

cp deploy/mission-control.service /etc/systemd/system/
cp deploy/mission-control-tick.service deploy/mission-control-tick.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mission-control
systemctl enable --now mission-control-tick.timer

systemctl status mission-control          # should be "active (running)"
systemctl list-timers mission-control-tick.timer   # shows the next fire
```

## 5. Caddy

The dashboard has no login of its own — every page and every server action
(approve a card, run an agent, delete a memory) trusts whoever can reach it.
`deploy/Caddyfile` puts the whole domain behind HTTP Basic Auth to close
that, carving out only the three webhook paths that already check their own
secret and whose callers can't supply a username/password (Telegram, Resend,
`/api/tick`). Generate your own password hash first — never commit a real
one:

```bash
caddy hash-password
```

It prompts for a password and prints a bcrypt hash. Open `deploy/Caddyfile`
and replace `REPLACE_WITH_YOUR_OWN_HASH` with that output, and `ates` with
whatever username you want to type at the browser prompt. Then:

```bash
cp deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

`deploy/Caddyfile` is already set to `mission.atesflowagency.com` — a new
subdomain, not the apex, since `atesflowagency.com` itself already points
at the separate VPS running n8n. Point *that subdomain's* DNS A record at
this VPS before reloading Caddy; the apex record and n8n's OAuth redirect
URIs are untouched.

Visit `https://mission.atesflowagency.com` — the browser should now ask for
a username and password before showing anything. After that, the dashboard
loads as before: every agent and none of the demo fixtures (no leads, no
deals, no activity yet — that's correct for a system that hasn't run
anything real).

## 6. Telegram webhook

```bash
curl -F "url=https://mission.atesflowagency.com/api/telegram" \
     -F "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
     "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook"

curl https://mission.atesflowagency.com/api/telegram   # {"status":…,"voice":…}
```

Send `/brief` from your phone — it should answer, with the real (empty)
state rather than demo numbers.

## 7. Resend inbound (optional)

Only if replies should come back through the Brain and Telegram rather than
just an inbox nobody's watching. In Resend's dashboard, on each verified
domain: turn on **Enable receiving**, set the webhook URL to
`https://mission.atesflowagency.com/api/resend`, copy the signing secret it
gives you into `RESEND_WEBHOOK_SECRET`, restart the service.

```bash
curl https://mission.atesflowagency.com/api/resend   # {"status":"configured"}
```

Send a real reply to a `RESEND_FROM_WEB` / `RESEND_FROM_AUTOMATION` address
and confirm it shows up on Telegram. The inbound payload shape the route
parses is Resend's documented one at the time it was written — an inbound
schema drifts more easily than an outbound API call, so if nothing arrives,
check the request actually reached Caddy/the app (not a signature rejection)
before assuming the field names moved.

## 8. Takvim ve Meet (optional)

The `.ics` feed from step 3 can only *read* the calendar. Booking a meeting,
moving it, cancelling it, and minting a Google Meet link need a real OAuth
client. About twenty minutes of console work, done once.

Nothing on the calendar happens unattended once this is wired: creating,
changing and cancelling are all behind an unconditional approval, so each one
lands on Telegram first and is reported back afterwards with the Meet link and
who was invited. The gate is in the tool, not in config — no YAML edit and no
autonomy setting can remove it.

1. **Google Cloud Console** → the same project as the Places key →
   *APIs & Services* → *Library* → enable **Google Calendar API**.
2. *APIs & Services* → **OAuth consent screen** → **External**. Fill in the app
   name and your own email. Under **Test users**, add the Gmail account whose
   calendar this is. Publishing is not needed — a test user's refresh token does
   not expire while the app stays in testing, as long as that account is listed.
3. *Credentials* → **Create credentials** → **OAuth client ID** →
   **Desktop app**. Copy the client ID and secret into `.env`:

   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

4. Mint the refresh token. Scripts do not read `.env` on their own (same as
   `db:push` in step 3), so source it first:

   ```bash
   cd /opt/mission-control
   set -a; source .env; set +a
   npm run google:auth
   ```

   It prints a Google URL. Open it in any browser, approve with the account from
   step 2, and Google redirects to `http://localhost:<port>/?code=...`. On the
   server that page will not load — **that is expected**; copy the whole URL out
   of the address bar and paste it back into the terminal. (Running this on a
   laptop instead, the redirect is caught automatically and there is nothing to
   paste.)

5. Paste the printed `GOOGLE_REFRESH_TOKEN=...` into `.env`. If the agency has
   its own calendar rather than the account's default, add its ID too —
   Google Calendar → that calendar's settings → *Takvim kimliği*:

   ```
   GOOGLE_REFRESH_TOKEN=...
   # GOOGLE_CALENDAR_ID=...
   ```

6. Restart and check:

   ```bash
   sudo systemctl restart mission-control
   set -a; source .env; set +a
   npm run agent:run -- shared.ops.assistant --task "Önümüzdeki 7 gündeki toplantıları listele."
   ```

   A configured calendar lists the week. An unconfigured one answers
   `⚠️ Takvim kullanılamıyor (...)` — which is the honest failure, not a crash,
   so the rest of the system keeps working while this is half-done.

Keep `CALENDAR_URL` set. `fetchDay()` prefers OAuth and falls back to the feed,
so a dead token costs the Meet links in the brief rather than the brief.

**Kur** needs nothing here. TL amounts are converted through TCMB's daily XML;
`fx.source` switches to `erapi` by telling the manager on Telegram if TCMB is
flaky. Verify it on the box, because a dev sandbox usually cannot reach either:

```bash
set -a; source .env; set +a
npm run agent:run -- shared.ops.assistant --task "45 bin TL kaç dolar? Kurun tarihini de yaz."
```

A real answer names the rate and the date it belongs to. On a Monday that date
is usually Friday's — correct, and the reason the date is always printed.

## v1 → v2 geçişi (bir kez)

VPS bugün **v1** çalıştırıyor: 49 ajan satırı, org ağacı paneli, eski görünümler.
v2 dört ajanlı ve panel baştan yazıldı, yani bu güncelleme sıradan bir `git pull`
değil — veritabanındaki kadro da değişmek zorunda.

```bash
cd /opt/mission-control
git pull
npm install
npm run db:push          # 6 migration: ayarlar, görev kuyruğu, outreach_days, …
npm run db:seed:fresh    # kadroyu 49'dan 4'e indirir + duran kararları yazar
npm run build
sudo systemctl restart mission-control
```

**Hareket geçmişi silinmez.** `activity.agent_id` Faz 1'de `CASCADE`'den
`SET NULL`'a çevrildi, tam da bu an için: eski ajan satırları giderken onların
yazdığı kayıtlar kalır, panelde "silinmiş ajan" olarak görünür. Beyin, lead'ler,
fırsatlar, projeler ve faturalar da olduğu gibi durur — `--fresh` yalnızca ajan
tablosunu ve duran kararları tazeler.

Sunucu **açıkken build alma.** Chunk hash'leri kayar ve tarayıcı CSS'i 404 alır;
sayfa stilsiz gelir. Olduysa: servisi durdur, `rm -rf .next`, yeniden build al,
başlat.

Geçtikten sonra gözle doğrula:

```bash
curl -s localhost:3000/api/state          # {"running":…,"parked":…,"pending":…}
npm run agent:list                        # 4 ajan
npm run tick -- --plan                    # 2 programlı çalışma (Ops, Scout)
```

Panelde dört sekme olmalı — **Bugün · Hat · Para · Hafıza** — ve hiçbirinde ajan
çalıştıran/duraklatan düğme bulunmamalı. `/activity` artık yok; içeriği Bugün'ün
"Son hareketler" bölümünde.

### Burada doğrulanamayan üç şey

Geliştirme ortamının çıkış proxy'si TCMB'yi ve döviz API'lerini engelliyor,
`ANTHROPIC_API_KEY` de orada yok. Bunlar ilk kez VPS'te çalışacak:

```bash
set -a; source .env; set +a

# 1. Kur — gerçek bir TL çevrimi, tarihiyle birlikte
npm run agent:run -- shared.ops.assistant --task "45 bin TL kaç dolar? Kurun tarihini de yaz."

# 2. Web araştırma — gerçek, linklenebilir örnekler
npm run agent:run -- shared.outreach.scout --task "İzmir'de kuaför sektöründe iyi üç site bul, linkleriyle."

# 3. Önbellek — Telegram'dan arka arkaya iki mesaj yaz, sonra:
npm run brief -- --raw > /dev/null   # ısıtma değil, yalnızca çalıştığını görmek için
```

Üçüncüsü için gerçek ölçüm Anthropic konsolunda: iki ardışık Yönetici mesajından
sonra `cache_read_input_tokens` sıfırdan büyük olmalı. Sıfır kalıyorsa sessiz bir
geçersizleştirici var demektir.

## Updating

```bash
cd /opt/mission-control
git pull
npm install               # only if dependencies changed
npm run db:generate       # only if src/db/schema.ts changed, then commit the SQL
npm run db:push           # applies any new migrations
npm run build
systemctl restart mission-control
```

The tick timer needs no restart for a code change — it starts a fresh
`tsx scripts/tick.ts` process every 15 minutes regardless.

## Rollback

Both services are unaffected by seed. If a bad deploy needs reverting:

```bash
git checkout <previous-commit-or-tag>
npm install && npm run build
systemctl restart mission-control
```

Nothing here touches the database on rollback — migrations are forward-only,
matching `npm run db:push`'s own model.
