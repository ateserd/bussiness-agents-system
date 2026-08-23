# SETUP_TODO

Every `[[ BLANK ]]` still in the system, grouped by **what filling it unblocks**.

Nothing here is invented. Where a value was not supplied it stays a literal
placeholder in the config, and any agent that needs it reports the gap rather
than guessing — that is §3 rule 3 working as designed, not a bug.

The dashboard runs with all of these unfilled. `npm run dev` needs none of them.

---

## Already filled in

| | |
|---|---|
| Branch A | **Ateş Design Agency** — website design |
| Branch B | **Ateş Flow Agency** — AI automation |
| Timezone | Europe/Istanbul |
| UI language | Turkish (code and identifiers English) |
| Agent names | Plain English role names |
| Models | COS + Directors + Leads `claude-sonnet-5` · Workers `claude-haiku-4-5` (all three top roles were `claude-opus-5`; moved to Sonnet as a cost cut) |

---

## 1. Identity — unblocks the deck header, the brief, and the chat channel

**Filled.** Ateş · Kurucu · weekdays 16:00–20:00, weekends 09:00–19:00
(`src/lib/owner.ts`), with `isWorkingHour()` for scheduling decisions.

These hours are inverted against a normal working week, and the §7 cadences
were rewritten around them — everything that wants Ateş is now ready *before* a
window opens rather than during it:

| Cadence | Was | Now |
|---|---|---|
| Morning brief | 07:45 daily | **07:30 daily** |
| Department leads' end-of-day | 17:00 weekdays | **15:15 weekdays** — filed before he sits down at 16:00 |
| Director weekly review | 09:00 Monday | **07:00 Monday** |

Still on the old clock, not raised: the evening wrap (19:00 daily), the weekly
P&L (09:00 Monday), Client Success (10:00 weekdays), Brain Keeper (16:00 Friday)
and Call Prep (09:30 weekdays). Call Prep is the one worth a second look — it
writes briefs for the day's calls at 09:30, which on a weekday is six hours
before he is reachable.

---

## 2. Outreach — unblocks Prospector, Auditor, Dossier, Draftsman, Sender

Until these exist, outreach agents can list and audit but cannot legitimately
build a target list or send anything.

**The owner's standing rule, and how it is enforced.** Nothing reaches a
stranger without being approved first, one message at a time. This is not a
config setting: `outreach_send` and `send_contract` call `requireApproval`
**unconditionally**, with no `gatedBy` check, so deleting the gate from an
agent's YAML or raising it to `act_freely` still cannot open a path to an
inbox. Each approval is pushed to Telegram as it is created, so the owner is
asked rather than expected to check a dashboard. Agents never write replies to
incoming mail; they draft, and the draft waits. These rules also live in the
Brain as permanent global memories, so every agent reads them at run time.

**ICP A — Ateş Design** (Brain, `branch.web`): anywhere in Turkey, any sector,
under 30 staff, and **no website at all**. Disqualified: chains and franchises,
and businesses with zero Google reviews — no reviews means too small for this
work. A prospect who turns out to have a site is out, however good it looks.

**ICP B — Ateş Flow** (Brain, `branch.automation`): anywhere in Turkey, any
sector, under 30 staff, running systems that AI can be integrated into. The
qualifying test is n8n: if n8n cannot connect to what they use, the lead is out.
That constraint is the filter, not a footnote. Same disqualifiers as ICP A.

| Blank | Where | Notes |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | `.env` | **Wired: Google Places API**, both branches. Returns the two signals the ICPs turn on — has-a-website and review count — plus the phone number Ateş dials. The `places_search` tool applies each branch's filter itself, so what comes back is already qualified. Behind the `spending_money` gate: a search costs money |
| `RESEND_API_KEY` | `.env` | **Wired end to end.** `/approve` on an email-channel outreach card calls Resend directly — approval is delivery, not a separate step. Requires the sending domain verified in Resend (DNS records it generates) before it will actually deliver |
| `RESEND_FROM_WEB` / `RESEND_FROM_AUTOMATION` | `.env` | One address per branch, on its own domain — not the operational domain (n8n, webmail, this dashboard). Missing for a branch reports that plainly rather than borrowing the other branch's identity |
| `RESEND_WEBHOOK_SECRET` | `.env` | **Inbound replies, wired at `/api/resend`.** Turn on "Enable receiving" on the domain in Resend, point its webhook there, paste the signing secret here. Never auto-replies — a reply is written to the Brain (client-scoped) and pushed to Telegram; the owner still writes and sends the reply by hand |
| Sender daily cap | `agents/*/outreach/sender.yaml` | **10 per mailbox per day.** Below the 20–30 "safe" ceiling on purpose: every message needs its own approval, and 10 approvals fits a 4-hour weekday window where 50 would not |
| Prospector target | `agents/*/outreach/prospector.yaml` | **50 / week** — matched to the 10/day send cap, so no lead is found and then deleted unused |
| Auditor target | `agents/web/outreach/auditor.yaml` | **30 / week** |
| Draftsman target | — | **None, deliberately.** It writes exactly as many drafts as there are messages to send; a number would either cap real work or invent it |

**The Auditor was rebuilt for ICP A.** Its job was "visit the prospect's current
website and score it" — but every valid ICP A lead has no website, so there
would have been nothing to visit. It now confirms the absence, then audits what
a customer actually finds instead: the Maps listing, the review count and
recency, whether the owner replies, the photos, and which social profile is
doing a website's job. Lighthouse stays for the rare prospect who turns out to
have a site — which is a disqualification, and a finding.

**How to write an ICP into the Brain** (this is the intended path — business
facts never live in prompt files). No API key, no dev server:

```bash
npm run remember -- --scope branch.web --permanent \
  "Web şubesi ICP'si: 5-30 çalışanlı, İstanbul/İzmir/Antalya'da …"

npm run remember -- --list branch.web    # what that branch knows
```

**The scope is the whole point.** An ICP written to `global` reaches both
branches, so the web ICP silently becomes the automation branch's ICP too —
`scopeMatches` returns true on the first `global` it sees. `--scope` has no
default for exactly this reason.

From the phone, prefix the branch:

```
/remember web: Web şubesi ICP'si: …
/remember otomasyon: Otomasyon ICP'si: …
/remember Sahip önce sayı ister.        ← no prefix stays global
```

Or in code, through the same single write path:

```ts
import { writeMemory } from "@/lib/brain/write";
await writeMemory({
  kind: "fact",
  scopes: ["branch.web"],
  content: "Web şubesi ICP'si: …",
  permanent: true,
  confidence: 0.95,
});
```

---

## 3. Proposals & contracts — unblocks Closer Support, Scoper, Proposal Agent

| Blank | Where | Notes |
|---|---|---|
| Pricing | — | **Chosen: no rate card.** Prices are per-project and set by Ateş, in USD. Seeded as a permanent global rule: an agent writes the scope and the timeline, leaves the number blank, and asks. The old "read the price from the Brain's rate card" rule is gone — it described a card that will never exist |
| E-signature | — | **Chosen: manual.** No tool. `send_contract` is gated unconditionally, so an agent's job ends at a drafted contract in the approval queue; the owner signs |
| Stale threshold | Brain, `dept.web.sales` / `dept.automation.sales` | **14 days**, now an explicit decision in both branches rather than a low-confidence lesson |
| Escalation ceiling | `agents/shared/command/chief_of_staff.yaml` | **None — every decision that commits money is escalated**, whatever the amount |

---

## 4. Delivery & build — unblocks Design, Build, Builder, Shipper

**Chosen and wired:**

| Choice | Where it lives |
|---|---|
| Site builder → **Next.js + Tailwind** | `agents/web/delivery/build_agent.yaml` mission |
| Design → **code-first** (React components, Tailwind scales; no design-file handoff) | `agents/web/delivery/design_agent.yaml` mission |
| Automation platform → **n8n** | `agents/automation/build/builder.yaml` mission |
| Lighthouse → **PageSpeed Insights** | `src/lib/agents/tools.ts` → `lighthouse` |

Changing any of them is a one-line edit to that mission; the prompts stay
platform-agnostic on purpose, so no prompt needs touching.

| Blank | Where | Notes |
|---|---|---|
| `GOOGLE_PAGESPEED_API_KEY` | `.env` | Optional. PSI serves low volume keyless, but the shared quota runs out fast and a 429 makes the Auditor report "could not measure" instead of a score |

---

## 5. The Ledger — unblocks Finance and the cash lines in every brief

Payment processing was removed outright rather than left as a dangling
optional key — cash and IBAN by permanent decision, entered by hand.

The LEDGER shows a real per-branch P&L: revenue less hand-entered expenses
less the token spend already recorded per run. Expenses with no branch — the
accountant, bank fees — are split evenly rather than landing on whichever
branch is listed first.

```bash
npm run money -- in  --amount 45000 --branch web --client "Kumsal Balık"
npm run money -- out --amount 18000 --category kira --recurring "Ofis kirası"
npm run money -- list --days 30
```

| Blank | Where | Notes |
|---|---|---|
| Income + expenses | `npm run money` | **Chosen: manual.** Money arrives as cash or bank transfer, so the recorded payments *are* the source of truth. `money in` records a collection, `money out` an expense, `money list` shows both. The LEDGER now reports a real net, not revenue wearing a profit label |
| `CALENDAR_URL` | `.env` | **Wired.** A secret-address `.ics` feed (Google Calendar → "Secret address in iCal format") — no OAuth. Feeds `callsToday` in the brief |
| `[[ ACCOUNTING TOOL ]]` | integration | Optional now. `npm run money out` covers the expense side; an integration would only save typing |
| `[[ CRM ]]` | integration | Currently the built-in `leads` / `deals` tables, which work. Only worth replacing if you already live in another CRM |

---

## 6. Your phone — unblocks the chat channel and approval cards

| Blank | Where | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `.env` | **Without it every agent runs in simulate mode.** Real activity and memory rows are still written; no model is called |
| `TELEGRAM_BOT_TOKEN` | `.env` | `/api/telegram` returns 503 until set |
| `TELEGRAM_CHAT_ID` | `.env` | Pins the bot to you — other chats are ignored |
| `TELEGRAM_WEBHOOK_SECRET` | `.env` | Checked before the body is parsed |
| `OPENAI_API_KEY` | `.env` | Voice notes only. Anthropic has no speech-to-text endpoint, so this is the one call to another provider. Unset → voice notes reply that they could not be transcribed; typed commands are unaffected |

Once the token exists:

```bash
curl -F "url=https://<your-host>/api/telegram" \
     -F "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
     "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook"
```

The command set (`/brief`, `/branch`, `/approve`, `/reject`, `/pause`, `/run`,
`/remember`, `/blockers`) is implemented in `src/lib/chat/commands.ts` and
shared with `npm run brief`; `deliver()` calls the real `sendMessage`. Nothing
is left but the tokens.

A voice note is transcribed, echoed back so a misheard command is visible, then
run through the same parser a typed message uses — the Brain's "sesli not bir
talimattır, bilgi değil" as code.

Check what is configured:

```bash
curl https://<your-host>/api/telegram     # {"status":…,"voice":…}
```

---

## 7. Scheduling — unblocks the §7 cadence table firing on its own

`npm run tick` runs whatever is due, and is idempotent, so any scheduler can
call it. **`/api/tick` and `vercel.json` are now wired**; all that is missing is
the secret.

| Blank | Where | Notes |
|---|---|---|
| `CRON_SECRET` | `.env` | Until set, `/api/tick` returns 503. `npm run tick` is unaffected |

```bash
# generate one
openssl rand -hex 32
```

Set the same value in the Vercel project's environment and Vercel Cron sends it
as a bearer token on its own. Any other scheduler sends it as a header:

```bash
curl -H "x-cron-secret: $CRON_SECRET" https://<your-host>/api/tick
```

| Option | How |
|---|---|
| Vercel Cron | Already in `vercel.json` — every 15 min, no further setup |
| A server | `*/15 * * * * cd /path && npm run tick` (needs no secret) |
| Inngest / Trigger.dev | Call `tick()` directly from a scheduled function |

The route replays the **last 15 minutes** rather than only the current one.
`cronMatches` compares the minute exactly, so a cron delivered even a minute
late would otherwise skip everything due; replaying is safe because the
idempotency key makes an already-run minute a no-op. Override with `?window=N`
(1–60).

Check what would fire, without running anything:

```bash
npm run tick -- --plan
npm run tick -- --at "2026-08-24T09:00:00+03:00"
curl -H "x-cron-secret: $CRON_SECRET" "https://<your-host>/api/tick?plan=1"
```

**On serverless:** `tick()` runs due agents sequentially, each with a 120s
timeout and two retries. Eight leads come due together at 17:00, which can
outlast any function limit. A server cron running `npm run tick` has no such
ceiling and is the safer choice once the cadences get real.

---

## 8. Raising autonomy — do this last, and one agent at a time

Every agent ships at `propose` or `act_with_log`. **17 of them sit behind an
approval gate**; nothing they produce reaches the outside world until you tap
approve.

When an agent has proven itself, change one line in its YAML:

```yaml
autonomy: act_freely   # was: propose
```

That is the only switch. `gatedBy()` in `src/lib/agents/tools.ts` checks it, so
the gate lifts everywhere at once for that agent and nowhere else.

**Done:** `Pipeline Watch`, `Monitor`, `Auditor`, `Dossier`, `Trend Scout` are
now `act_freely` (both branches, where the role exists on both). Worth being
honest about why these were first: all five ship with an empty
`approval_required_for` — they only ever had `brain`/`crm`/`browser`/
`lighthouse` tools, nothing a gate was checking. Flipping them was a real
statement of trust and it is now visible on the dashboard, but it changed no
actual behavior; there was nothing to lift.

The next real lever is `Prospector` (`spending_money` — a real, small,
per-search cost). Leave `Sender`, `Proposal Agent`, `Shipper` and
`Handoff Agent` gated the longest — those are the ones that touch clients,
and `Sender`'s `sending_external_messages` can never be lifted by this
switch at all: that gate has no `gatedBy()` check, by design.
