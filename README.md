# Mission Control

A one-human, two-branch AI agency operating system.

**Ateş Design Agency** (websites) and **Ateş Flow Agency** (AI automation) are two
businesses, not two hierarchies. **Four agents cover both**; the branch is a
property of the *work* — a lead, a deal, a project, a memory — not of the agent.

The owner talks to exactly one of them, the **Yönetici**, over Telegram. It reads
free text, delegates, changes settings, and asks when it is unsure. The dashboard
is not a cockpit: it is a live mirror of what the agents are doing, and it has no
buttons that command anything.

```bash
npm install
npm run db:generate     # only after changing src/db/schema.ts
npm run db:push
npm run db:seed
npm run dev             # → http://localhost:3000
```

No API key, no Postgres server, no Docker, no network. The dashboard comes up
fully populated, and every agent runs in **simulate mode** until you add
`ANTHROPIC_API_KEY`.

Putting this on a server that stays up — `DEPLOY.md`.

---

## The four views

| Route | What it is |
|---|---|
| `/` | **Bugün** — what needs you, today's meetings and send batch, what is running, what just happened |
| `/pipeline` | **Hat** — lead → fırsat → proje → müşteri, both branches on one line |
| `/ledger` | **Para** — per-branch P&L plus a combined column and a 12-week trend |
| `/brain` | **Hafıza** — every memory as a constellation, clustered by branch and department |

`WALKTHROUGH.md` walks through each one, with screenshots.

---

## The three layers

```
SURFACE   src/app/, src/components/     four views, read-only
CREW      agents/shared/**.yaml          four agents, one file each
BRAIN     src/lib/brain/, memories       shared memory, scope-isolated
```

Plus a runtime (`src/lib/agents/`), a scheduler (`src/lib/scheduler/`), a chat
command set (`src/lib/chat/`), a settings catalogue (`src/lib/settings.ts`), a
task queue (`src/lib/tasks.ts`) and the outreach machinery
(`src/lib/outreach/`).

### The crew

| id | Ad | What it does |
|---|---|---|
| `shared.command.manager` | **Yönetici** | The only agent the owner talks to. Reads intent, delegates, changes settings, writes the brief, asks rather than guesses |
| `shared.outreach.scout` | **Scout** | Finds and qualifies leads from Google Places; researches a sector with real, linkable examples |
| `shared.outreach.writer` | **Outreach** | Writes cold mail and cold-call scripts. Never sends — that needs the owner |
| `shared.ops.assistant` | **Ops** | Meetings and calendar, TL→USD, invoices, pipeline hygiene |

**Branch isolation moved from the agent to the task.** All four are
`branch: shared`; a delegated task carries a branch and the worker runs with
memory scopes narrowed to it for that task only (`narrowScopes` in
`src/lib/brain/scope.ts`). Forgetting to tag a task with its branch is what a
leak looks like now.

---

## Adding an agent

Add one file. Nothing enumerates the crew, so nothing else needs to change.

```yaml
# agents/shared/outreach/researcher.yaml
id: shared.outreach.researcher
display_name: "Researcher"
branch: shared
department: outreach
tier: worker
reports_to: shared.command.manager
accent: "#ff4d6d"
status: idle
model: claude-sonnet-5
effort: medium
mission: >
  One paragraph: what this agent owns and what "done" looks like.
system_prompt_file: prompts/shared.outreach.researcher.md
tools:
  - "brain.read"
  - "brain.write"
  - "browser"
memory_scopes:
  - "global"
  - "branch.web"
  - "branch.automation"
  - "dept.web.outreach"
schedule: "0 8 * * 1-5"     # or null
autonomy: propose
approval_required_for: []
escalate_to_human_when: []
kpis: []
```

Then write `prompts/shared.outreach.researcher.md` — role, method, what done
looks like, what it must never do. Keep business facts **out** of it; those live
in the Brain and get injected at run time.

**Every name in `tools:` must exist in `BUILDERS`** (`src/lib/agents/tools.ts`).
`toolsFor()` drops an unknown name silently — in v1 `agent.dispatch` was declared
in eleven files and implemented in none, so the Chief of Staff could never
actually delegate.

The registry validates every file at boot and refuses to start on a bad one: a
duplicate id, a `reports_to` that does not exist, a missing prompt file, more
than one root, or a model with no price in `cost.ts` all fail loudly.

```bash
npm run agent:list                            # see the whole crew
npm run agent:run -- shared.outreach.scout
```

---

## Departments and branches

`DEPARTMENTS` and `BRANCHES` are const arrays in `src/db/schema.ts`, consumed by
the Zod schema in `src/lib/agents/registry.ts`. Adding either is adding a string
there plus a name in `copy.department` / `copy.branch` — the database needs no
migration, because `branch` and `department` are text columns and deliberately
not pg enums.

Memory scopes are branch-qualified — `dept.web.outreach`, not `dept.outreach`.
That is load-bearing: both branches have a department called *outreach*, and an
unqualified scope let a web agent read automation memories. It was a real leak,
caught in the seed.

A memory is either `global` **or** branch-scoped, never both:
`["global", "branch.web"]` makes `global` win and opens everything to everyone.
`assertWritableScopes()` rejects that inside `writeMemory()` — but *choosing* the
wrong scope is still on you, which is why `npm run remember` has no default.

## Storage: PGlite now, Supabase later

Schema is authored once in the Postgres dialect (`src/db/schema.ts`). Locally it
runs on **PGlite** — Postgres compiled to WASM, in-process, writing to `./data/` —
so a clean checkout needs no server.

To move to Supabase or Neon:

```bash
# 1. point at the new database (Supabase: use the Session pooler string,
#    not db.<ref>.supabase.co, which is IPv6-only)
echo 'DATABASE_URL=postgresql://…' >> .env

# 2. same migrations, same schema
npm run db:push
npm run db:seed        # only if you want the demo data there too
```

`src/db/client.ts` is the only file that knows which driver is in use.

### Memory search: JS cosine now, pgvector later

Embeddings are stored in a `real[]` column and ranked with a dot product in JS.
At a few thousand memories this is sub-millisecond and the query cost is
dominated by fetching rows either way — and PGlite 0.5 does not bundle the
vector extension, so this keeps local dev honest rather than pretending.

When the corpus outgrows it:

```sql
create extension if not exists vector;
alter table memories add column embedding_v vector(256);
update memories set embedding_v = embedding::vector(256);
create index on memories using hnsw (embedding_v vector_cosine_ops);
```

Then change `recall()` in `src/lib/brain/search.ts` to order by
`embedding_v <=> $1` in SQL instead of sorting in JS. The scope filter
(`scopeOverlapSql`) already runs in SQL and does not change.

---

## The rules the code enforces

These are not documentation — they are single points in the code, so they cannot
drift:

| Rule | Where it lives |
|---|---|
| **Branch isolation** — an agent reads only its own scopes | `src/lib/brain/scope.ts` (`scopeMatches`) |
| **Approval gates** — nothing leaves without your tap | inside each gated tool's `run()`, `src/lib/agents/tools.ts` |
| **Contacting a stranger always asks** — not per-agent config, so no YAML edit or autonomy change can open it | `outreach_send` and `send_contract` call `requireApproval` with no `gatedBy` check |
| **The calendar never changes without asking** — create, move and cancel alike | `meeting_schedule` / `meeting_update` / `meeting_cancel`, gated the same unconditional way |
| **No business number is hardcoded** — daily cap, thresholds, brief times, cost ceiling | the catalogue in `src/lib/settings.ts`; the table is only an override layer |
| **A day's instruction expires** — "bugün 7 at" is not "always 7" | `outreach_days`, read by `planFor()` in `src/lib/outreach/plan.ts` |
| **Settings and daily plans are owner-channel only** — inbound mail lands in the Brain, and agents read the Brain | `settings_write` and `outreach_plan` mount only when `ctx.ownerChannel` is true |
| **Approval settles in one place** — dashboard and Telegram cannot diverge | `settleApproval()` in `src/lib/approvals.ts` |
| **Report reality** — a missing source is named, never faked | `getLedger()`, `buildBrief()`, and the `lighthouse` tool |
| **Everything is logged** | `runAgent()` writes one `activity` row per run |
| **Lead retention** — untouched leads are deleted after 30 days, contacted ones kept | `pruneLeads()`, run daily from `tick()` |
| **Self-critique** | the house rules in `src/lib/agents/prompt.ts` require a closing `BELİRSİZ:` line, parsed by `extractUnsure()` |
| **Atomic memory** | `writeMemory()` rejects anything over 600 chars and merges near-duplicates |

---

## Commands

```bash
npm run dev              # dashboard
npm run build            # production build
npm run typecheck        # tsc --noEmit
npm run lint

npm run db:generate      # schema.ts → drizzle/*.sql
npm run db:push          # apply migrations   (-- --reset drops the local db)
npm run db:seed          # the crew, demo memories, 30 days of activity
npm run db:seed:fresh    # the crew + standing decisions only — no demo data (real deployments)

npm run agent:list       # the whole crew
npm run agent:run -- <agent.id> [--task "..."]
npm run brief            # today's brief, as it would arrive on your phone
npm run remember -- --scope branch.web "…"   # write a business fact to the Brain
npm run remember -- --list branch.web        # read back what a scope holds
npm run money -- in --amount N --branch web --client "…"   # a collection
npm run money -- out --amount N --category kira "…"        # an expense
npm run money -- list                                       # both, last 30 days
npm run tick             # run whatever is due: cadences, the queue, and the daily system steps
npm run tick -- --plan   # show the cadence table without running
npm run google:auth      # one-shot: mint the Google Calendar refresh token
```

`tick()` also carries four things that are **not** agent runs, deliberately —
they must happen whether or not a model is reachable and whether or not an agent
remembers them: lead retention, the stale-run reaper, the daily outreach batch,
and the morning brief / evening wrap. Their hours come from settings, which is
why they cannot live in the cron-string cadence table.

On a deployment the same thing happens on its own every 15 minutes. Two
paths exist:

- **Vercel** — already wired via `/api/tick` and `vercel.json`, once
  `CRON_SECRET` is set. Fine for light load; a request-timeout ceiling makes
  it the wrong choice once several agents come due in the same minute (see
  `DEPLOY.md`).
- **A server with its own cron** (recommended) — `*/15 * * * * cd /path &&
  npm run tick`, no secret needed, no request timeout to outlast.

```bash
curl -H "x-cron-secret: $CRON_SECRET" "https://<your-host>/api/tick?plan=1"
```

`DEPLOY.md` walks through the second path end to end — a VPS, Supabase
instead of PGlite, systemd instead of a serverless function, Caddy for TLS.

---

## What is not wired up

Stated plainly, because a dashboard that looks finished is easy to mistake for
one that is:

- **No model is called** without `ANTHROPIC_API_KEY`. Simulate mode writes real
  activity and memory rows so the loop is verifiable, and labels itself `SİMÜLE`.
- **Some integrations need keys.** Lighthouse (PageSpeed), Google Places and the
  calendar are wired but inert until their keys exist; each reports itself
  unavailable rather than guessing. Money in and out is entered by hand with
  `npm run money` — there is no processor to read it from.
- **Booking a meeting needs Google OAuth.** The read-only `.ics` feed can list a
  day; creating, moving or cancelling an event and minting a Meet link needs a
  real OAuth client. `npm run google:auth` prints the refresh token;
  `DEPLOY.md` § 8 walks the console work. Without it the meeting tools answer
  `⚠️ Takvim kullanılamıyor` and the brief falls back to the feed.
- **TL→USD needs no key.** Rates come from TCMB's daily XML, with `fx.source`
  switchable to `erapi`. An unreachable source converts nothing and says so —
  it never falls back to a guessed rate.
- **Cold mail goes out in one batch, once a day.** Drafts still become approval
  rows, but the owner is asked once, in one Telegram message, and answers once
  (`gönder` · `3 hariç` · `1,2,5` · `iptal`). The gate is unchanged; only its
  granularity is.
- **Cold email dispatches for real on approval.** `RESEND_API_KEY` plus a
  `RESEND_FROM_WEB` / `RESEND_FROM_AUTOMATION` address per branch, and
  `/approve` on an email-channel card calls Resend directly — no separate
  "now send it" step. Other channels (Instagram DM, etc.) still land approved
  but stay manual; no provider is wired for those.
- **Replies come back through `/api/resend`.** Enable receiving on the domain
  in Resend, point its webhook there, set `RESEND_WEBHOOK_SECRET`. A reply is
  written to the Brain and pushed to Telegram — never auto-replied to; the
  owner still writes and sends the reply by hand, same as everything else.
- **Telegram needs a bot token.** The command handling and the transport are
  both real; approvals are pushed to the phone as they are created.
- **Nothing reaches a stranger unattended.** `outreach_send` and `send_contract`
  require an approval unconditionally — not via per-agent config — so no YAML
  edit or autonomy change can open a path to someone's inbox.
- **The clock needs a secret.** `/api/tick` and a 15-minute `vercel.json` cron
  are wired, but the route returns 503 until `CRON_SECRET` is set. `npm run tick`
  needs nothing and is unaffected.

All of it is itemised in `SETUP_TODO.md`, grouped by what each blank unblocks.
`DEPLOY.md` covers the other axis — not what to configure, but where this
actually runs once it's live.
