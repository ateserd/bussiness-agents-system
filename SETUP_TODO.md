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
| Models | COS + Directors `claude-opus-5` · Leads `claude-sonnet-5` · Workers `claude-haiku-4-5` |

---

## 1. Identity — unblocks the deck header, the brief, and the chat channel

| Blank | Where | Notes |
|---|---|---|
| `[[ YOUR NAME ]]` | `src/lib/owner.ts` → `OWNER_NAME` | Shows at the tree apex and opens every brief |
| `[[ e.g. Founder / The Human ]]` | `src/lib/owner.ts` → `OWNER_TITLE` | |
| `[[ e.g. 09:00–19:00 ]]` | `src/lib/owner.ts` → `WORKING_HOURS` | Used to decide what counts as "today" |

One edit to `src/lib/owner.ts` clears all three.

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

| Blank | Where | Notes |
|---|---|---|
| `[[ ICP A ]]` | write to the Brain, scope `branch.web` | Prospector reads it at run time and **stops** if absent |
| `[[ ICP B ]]` | write to the Brain, scope `branch.automation` | same |
| `APOLLO_API_KEY` | `.env` | **Chosen: Apollo.** Phone numbers are a requirement — the owner cold-calls by hand — and they cost mobile credits on top of the seat. See the credit note below |
| `RESEND_API_KEY` | `.env` | **Chosen: cold email**, plus manual calls. Every message still waits for its own approval |
| `[[ N ]]/day/channel` | `agents/*/outreach/sender.yaml` → `kpis.target` | Still open. Per-message approval is the real cap now, but a daily ceiling still protects domain reputation |
| `[[ N ]]` KPI targets | `agents/*/outreach/*.yaml` | Still open. Weekly leads, audits, dossiers |

**Apollo credits, before committing to a plan.** Mobile numbers cost 8 credits
each and direct dials 5, out of a monthly bucket of 75 on Basic, 100 on
Professional, 200 on Organization. On Basic that is roughly **9 mobile numbers
a month** — the binding constraint is credits, not the seat price. Apollo's
built-in dialer starts at Professional, but that does not matter here: the
owner dials manually, so Basic buys the same data.

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
| `[[ PRICE POINTS A ]]` | Brain, scope `branch.web` | The rate card. Agents refuse to quote without it |
| `[[ PRICE POINTS B ]]` | Brain, scope `branch.automation` | Build fee bands + retainer bands |
| E-signature | — | **Chosen: manual.** No tool. `send_contract` is gated unconditionally, so an agent's job ends at a drafted contract in the approval queue; the owner signs |
| `[[ N ]] days` stale threshold | Brain, scope `dept.web.sales` / `dept.automation.sales` | Currently seeded at 14 days |
| `[[ $N ]]` escalation ceiling | `agents/shared/command/chief_of_staff.yaml` | Above this, the COS escalates rather than deciding |

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

The LEDGER now shows a real per-branch P&L: revenue less hand-entered expenses
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
| `STRIPE_SECRET_KEY` | `.env` | Optional, unused. If a key is ever set, revenue switches to what Stripe settled and expects `metadata.branch = web \| automation` on each charge |
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

Suggested order, safest first: `Pipeline Watch` → `Monitor` → `Auditor` →
`Dossier` → `Trend Scout`. Leave `Sender`, `Proposal Agent`, `Shipper` and
`Handoff Agent` gated the longest — those are the ones that touch clients.
