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

```bash
npm run build
npm run db:push       # creates the schema on the Supabase database
npm run db:seed:fresh # agents + every business fact Ateş actually decided —
                       # no fake leads, deals, clients or activity history
```

Use `db:seed:fresh`, not `db:seed`, on a real database. The default seed is
demo texture for a local checkout — a believable month of fabricated leads,
deals and activity so the dashboard looks alive on `npm run dev`. On the
database the LEDGER actually reads from, that texture would show up as real
revenue. `--fresh` writes only the 49 agents and the standing decisions
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

```bash
cp deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

`deploy/Caddyfile` is already set to `mission.atesflowagency.com` — a new
subdomain, not the apex, since `atesflowagency.com` itself already points
at the separate VPS running n8n. Point *that subdomain's* DNS A record at
this VPS before reloading Caddy; the apex record and n8n's OAuth redirect
URIs are untouched.

Visit `https://mission.atesflowagency.com` — the dashboard should load,
showing 49 agents and none of the demo fixtures (no leads, no deals, no
activity yet — that's correct for a system that hasn't run anything real).

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
