# Mission Control

A one-human, two-branch AI agency operating system.

**Ateş Design Agency** (websites) and **Ateş Flow Agency** (AI automation) run as
two structurally separate branches — own departments, own agents, own pipelines,
own P&L — joined only at the top (the owner and a Chief of Staff) and at a shared
services layer. Forty-nine agents, one shared memory, one dashboard.

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
| `/` | **COMMAND** — the org tree. Who exists, who reports to whom, who is working, blocked or waiting on you |
| `/brain` | **BRAIN** — every memory as a constellation, clustered by branch and department |
| `/activity` | **ACTIVITY** — every agent action: who, what, why, cost, duration, outcome |
| `/ledger` | **LEDGER** — per-branch scoreboard plus a combined column |

`WALKTHROUGH.md` walks through each one.

---

## The three layers

```
COMMAND   src/app/, src/components/     the surface
CREW      agents/*.yaml, prompts/*.md   the org
BRAIN     src/lib/brain/, memories      shared memory
```

Plus a runtime (`src/lib/agents/`), a scheduler (`src/lib/scheduler/`), and a
chat command set (`src/lib/chat/`).

---

## Adding an agent

Add one file. Nothing enumerates the crew, so nothing else needs to change.

```bash
# agents/web/outreach/researcher.yaml
```

```yaml
id: web.outreach.researcher
display_name: "Researcher"
branch: web
department: outreach
tier: worker
reports_to: web.outreach.lead
accent: "#ff4d6d"          # department colour
status: idle
model: claude-haiku-4-5
effort: low
mission: >
  One paragraph: what this agent owns and what "done" looks like.
system_prompt_file: prompts/web.outreach.researcher.md
tools:
  - "brain.read"
  - "brain.write"
  - "browser"
memory_scopes:
  - "global"
  - "branch.web"
  - "dept.web.outreach"
schedule: "0 8 * * 1-5"     # or null
autonomy: propose
approval_required_for: []
escalate_to_human_when: []
kpis:
  - name: items_found
    label: "Bulgu"
    target: "[[ N ]]"
    window: weekly
```

Then write `prompts/web.outreach.researcher.md` — role, method, what done looks
like, what it must never do. Keep business facts **out** of it; those live in the
Brain and get injected at run time.

The registry validates every file at boot and refuses to start on a bad one:
a duplicate id, a `reports_to` that does not exist, a missing prompt file, or
more than one root all fail loudly rather than silently.

```bash
npm run agent:list                        # see the whole crew
npm run agent:run -- web.outreach.researcher
```

---

## Adding a department

1. Create `agents/<branch>/<newdept>/lead.yaml` with `tier: lead` and
   `reports_to: <branch>.command.director`, plus its workers.
2. Give it a colour: add the accent to `:root` in `src/app/globals.css` and to
   `DEPT_COLOR` in `src/components/brain/constellation.tsx`.
3. Add its name to `copy.department` in `src/lib/copy.ts`.
4. Add it to `DEPT_ORDER` in `src/components/command/layout.ts` so it gets a
   column position.

Memory scopes are branch-qualified — `dept.web.outreach`, not `dept.outreach`.
That is load-bearing: both branches have a department called *outreach*, and an
unqualified scope would let a web agent read automation memories.

---

## Adding a third branch

The system was built so this is additive rather than a refactor.

1. **Agents.** Create `agents/<branch>/command/director.yaml` (`tier: director`,
   `reports_to: shared.command.chief_of_staff`) and its departments underneath.
2. **Layout.** In `src/components/command/layout.ts`, add the branch to `sideOf`.
   Two branches mirror around the centre; a third needs a position — either
   `sideOf.<branch> = 0` with a row offset, or switch the fan to
   `(i - (n-1)/2)` across all directors.
3. **Colour.** Add a cable tint in `TINT` (`src/components/command/org-tree.tsx`)
   and a cluster column in the constellation's `anchor()`.
4. **Copy.** Add its names to `copy.branch`.
5. **Ledger.** `getLedger()` in `src/lib/data.ts` maps over
   `["web", "automation"]` — add the third id there.
6. **Chief of Staff scope.** Add `branch.<new>` to its `memory_scopes`, and to
   each shared-services agent, so they can see it.

The database needs no migration: `branch` is a text column, deliberately not a
pg enum, exactly so a new branch is config rather than DDL.

---

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
npm run db:seed          # every agent, ~140 memories, 30 days of activity
npm run db:seed:fresh    # every agent + standing decisions only — no demo data (real deployments)

npm run agent:list       # the whole crew
npm run agent:run -- <agent.id> [--task "..."]
npm run brief            # today's brief, as it would arrive on your phone
npm run remember -- --scope branch.web "…"   # write a business fact to the Brain
npm run remember -- --list branch.web        # read back what a scope holds
npm run money -- in --amount N --branch web --client "…"   # a collection
npm run money -- out --amount N --category kira "…"        # an expense
npm run money -- list                                       # both, last 30 days
npm run tick             # run whatever the cadence table says is due
npm run tick -- --plan   # show the cadence table without running
```

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
- **Some integrations need keys.** Lighthouse (PageSpeed) and the calendar feed
  are wired but inert until their keys exist; each reports itself unavailable
  rather than guessing. Money in and out is entered by hand with `npm run
  money` — there is no processor to read it from.
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
