# SETUP_TODO

What still needs a human, and what each blank actually blocks.

Nothing here is invented. Where a value is missing the system says so —
`⚠️ <kaynak> kullanılamıyor (<sebep>)` — rather than guessing. That is the house
rule working, not a bug, and it is why the dashboard runs with every one of
these unfilled.

> This file used to be 300 lines organised around agents that no longer exist
> (Prospector, Auditor, Dossier, Closer Support…). v2 replaced the roster with
> four agents, and moved every business *number* out of config and into the
> settings catalogue — which is why most of what was here is simply gone rather
> than answered. The decisions themselves are in `V2_PLAN.md`.

---

## Already settled

| | |
|---|---|
| Branches | **Ateş Design Agency** (web) · **Ateş Flow Agency** (otomasyon) |
| Crew | Four agents — Yönetici · Scout · Outreach · Ops |
| Timezone | Europe/Istanbul (`owner.timezone`, changeable by saying so) |
| UI language | Turkish; code and identifiers English |
| Models | Yönetici / Scout / Outreach `claude-sonnet-5` · Ops `claude-haiku-4-5` |
| Every business number | In `src/lib/settings.ts` — 17 keys, all changeable from Telegram |

**There are no hardcoded business values left to fill in.** Daily send cap,
call count, stale thresholds, quiet-client threshold, brief times, cost ceiling,
concurrency, meeting length — all settings. Say "günlük mail sayısını 15 yap" and
it changes. That was the point.

---

## 1. Google Calendar OAuth — the one thing left

**Blocks:** booking, moving and cancelling meetings, and the Meet link.
**Without it:** the `.ics` feed still lists a day, so the brief keeps working;
the meeting tools answer `⚠️ Takvim kullanılamıyor` and stop.

About twenty minutes of console work, once. `DEPLOY.md` § 8 walks it end to end;
the short version is: enable the Calendar API → OAuth consent screen (External,
add your own Gmail as a test user) → create a **Desktop app** client → run
`npm run google:auth` → paste the printed refresh token into `.env`.

---

## 2. Keys that unlock a capability

Each is optional, and each names itself when missing.

| Key | Unblocks | Without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | every agent actually thinking | simulate mode — real activity and memory rows, no model call |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | the entire control surface | the panel still shows everything; nothing can be *told* to the system |
| `RESEND_API_KEY` + `RESEND_FROM_*` | cold mail actually leaving | drafts are written and approved, delivery reports `⚠️ gönderilemedi` |
| `RESEND_WEBHOOK_SECRET` | replies landing in the Brain and on your phone | replies sit in the inbox |
| `GOOGLE_PLACES_API_KEY` | Scout finding leads | Scout reports the source unavailable |
| `OPENAI_API_KEY` | voice notes on Telegram | typed messages unaffected; voice replies that it could not transcribe |
| `CRON_SECRET` | `/api/tick` firing on a schedule | `npm run tick` and the systemd timer are unaffected |
| `GOOGLE_PAGESPEED_API_KEY` | Lighthouse scores at volume | works keyless at low volume; a 429 reports "could not measure" |
| `CALENDAR_URL` | reading the day without OAuth | the brief says the calendar is unavailable |

**No key needed for currency.** TL→USD comes from TCMB's daily XML;
`fx.source` switches to `erapi` by telling the manager. An unreachable source
converts nothing and says so.

---

## 3. Raising autonomy — later, and one agent at a time

Every agent ships at `propose` or `act_with_log`. Two gates are **unconditional**
and no setting can open them:

- **`outreach_send`** — nothing reaches a stranger's inbox without an explicit
  yes for that specific batch
- **`meeting_schedule` / `meeting_update` / `meeting_cancel`** — the calendar
  never changes without being asked first

Raising an agent to `act_freely` loosens the *conditional* gates only
(`publish`, `deploy`, `spend`). Do it after a week of watching what it actually
proposes, and one agent at a time.

---

## 4. Verified only on the server

The development sandbox blocks TCMB and every currency API, and has no
`ANTHROPIC_API_KEY`. Three things therefore run for the first time in
production — treat each as a checkpoint, not a formality. The commands are in
`DEPLOY.md` § "v1 → v2 geçişi".

1. A real TL→USD conversion, with the rate's date
2. `web_search` / `web_fetch` returning real, linkable examples
3. Prompt-cache hits — `cache_read_input_tokens > 0` after two consecutive
   Telegram messages
