# Walkthrough

A written tour of each view — what you are looking at, what it is telling you,
and what to do with it. Screenshots of every state described here are in
`screenshots/`.

---

## COMMAND — `/`

**The screen you open every morning.**

The whole company, top to bottom, on one canvas. Read it in four seconds:

**The apex** is you. `[[ YOUR NAME ]]` in dashed type is not a rendering bug —
it is a blank the system refuses to invent. Fill `src/lib/owner.ts`.

**The Chief of Staff** sits directly beneath, gold-outlined, wide. Inside it a
live ticker carries the two numbers that matter and one warning:

```
WEB  6 açık teklif · $23.806
FLOW 6 açık teklif · 6/7 akış sağlıklı
⚠ Stripe: STRIPE_SECRET_KEY tanımlı değil
```

That third line is the system telling you it cannot see revenue rather than
showing you a zero. Every view does this.

**Flanking the Chief of Staff** are the four shared services — Finance, Client
Success, Brain Keeper, Recruiter. They serve both branches, which is why they sit
on the command row rather than under either director.

**Two directors** below, one per branch, each in its branch colour: Ateş Design
cool cyan, Ateş Flow warm amber. **Eight department leads** under them, each
carrying its department's accent on its top border — crimson outreach, cyan
sales, green delivery/build, violet content. **Thirty-four workers** hang beneath
their lead in the same colour.

### Reading state at a glance

| What you see | What it means |
|---|---|
| Node dimmed to ~60% | Idle. Nothing to do right now |
| Green dot, breathing, cable pulsing | Working. A light dot travels the cable *up* toward you — a report on its way |
| Gold ring, slowly pulsing | Waiting on your approval. Also badged in the tray, top right |
| Red, breathing slowly | Blocked. Something needs you to unblock it |

In the seeded state: **Auditor**, **Pipeline Watch**, **Prospector**, **Tester**
and **Client Success** are working; **Sender** and **Proposal Agent** are waiting
on you; **Monitor** and **Finance** are blocked.

### What you can do

- **Branch switcher** (`TÜMÜ · WEB · AI OTOMASYON`) zooms to one branch and dims
  the other. Shared services stay lit in both, because they belong to both.
- **Click any node** → a drawer with its mission, KPIs and 7-day sparkline, full
  config (model, autonomy, schedule, tools, memory scopes, gates), its recent
  runs with cost and duration, and the memories it wrote. Three buttons: run it
  now, pause it, chat with it.
- **The approval tray** (top right) opens the cards. Each carries the **full
  draft** — the actual message, the actual proposal — not a summary. Approve or
  reject; nothing sends until you tap.
- **Keyboard:** `F` fits, `1` jumps to Ateş Design, `2` to Ateş Flow. Drag to
  pan, scroll to zoom.
- **Bottom strip** — the shared memory count, linking to the Brain.

---

## BRAIN — `/brain`

**One memory. Every agent reads it, every agent writes to it, nobody has a
private one.**

A force-directed constellation of every memory, drifting slowly.

- **Position** is meaning. Ateş Design memories cluster left, Ateş Flow right,
  and within each the departments fan top to bottom: outreach, sales,
  delivery/build, content. Memories that belong to a whole branch, and the
  permanent facts that belong to the company, float between the two.
- **Size** is how often a memory has actually been retrieved. A big node is
  something the crew leans on.
- **Colour** is who owns it — department accent, or gold for a permanent fact.
- **Lines** are links between related memories. A gold line means one memory
  **supersedes** another: a decision that changed. In the seed, the stale-deal
  threshold moved from 10 days to 14, and both records are kept — the Brain
  Keeper's job is exactly this.

**Search** re-lights matches and dims the rest, so you can see where a topic
actually lives in the org. **Click a node** for the statement, its scope, who
wrote it, its confidence, and how often it has been used.

The counters at the bottom: memories, permanent facts, clients with their own
context, and links.

---

## ACTIVITY — `/activity`

**Every action, with its receipt.**

Pinned at the top: what is waiting on you, and what is blocked. Below that, a
reverse-chronological feed — roughly 290 rows across the last 30 days.

Each row: timestamp, agent (in its department colour), the action verb, the
outcome, and on the right the **cost in dollars and the duration**. Expand any
row (`›`) for the full input and output, the agent's stated reason, and — where
it recorded one — the thing it said it was unsure about:

> `? Lighthouse tek seferlik ölçüm; ağ koşulları etkilemiş olabilir.`

That line is required of every agent before it may report done. An agent that is
sure of everything has not looked hard enough.

Filter by branch, department, agent, or outcome. Rows marked `SİMÜLE` were
produced without calling a model.

---

## LEDGER — `/ledger`

**Two columns, one per branch, plus a combined total.**

Per branch: revenue MTD, cash collected, open pipeline value, live projects,
unpaid invoices with a count, and **what the agents themselves cost to run this
month**.

The combined column exists, but the branches are reported separately first and
on purpose — a single total that hides one branch subsidising the other is a lie
by arithmetic.

Revenue currently reads `⚠️ kaynak bağlı değil`. Stripe is not connected, so the
number is not derivable, so it is not shown. Cash collected, pipeline and
invoices *are* real — they come from the database — and are shown normally. The
distinction is the whole point.

At the bottom, twelve weeks of collected cash, per branch, stacked.

---

## The morning brief

Not a view — this is what arrives on your phone at 07:45, and what
`npm run brief` prints:

```
☀️ Günaydın brifingi — 21 Ağustos Cuma
Chief of Staff. Önce sayılar, sonra sana düşenler.

WEB
  Hat: 6 açık · $23.806 · 0 bugün görüşme
  Teslimat: 3 proje · 0 riskte
AI OTOMASYON
  Hat: 6 açık · $33.918
  Canlı akış: 6 sağlıklı / 1 hatalı
NAKİT
  Bu ay tahsil: $5.368 · Ödenmemiş: $19.184

⚠️ Stripe kullanılamıyor (STRIPE_SECRET_KEY tanımlı değil)
⚠️ Takvim kullanılamıyor (takvim kaynağı bağlı değil)

SANA DÜŞENLER:
  1. Kumsal Balık Restoran — ilk temas + 4 takip — onayını bekliyor.
  2. Ege Tekstil İhracat — kurulum + aylık bakım teklifi — onayını bekliyor.
  3. Monitor engelli: Poyraz İK aday eleme akışı 14 Ağustos'tan beri hata
     veriyor — tedarikçi API anahtarı süresi doldu, yenisi gerekiyor.
```

Numbers first. Then the unavailable sources, named. Then at most three things
that need a decision from you. If nothing needs you, it says so.

---

## Watching one agent work

The fastest way to understand the whole system is to run a single agent and
follow what it leaves behind:

```bash
npm run agent:run -- web.outreach.auditor
```

```
  outcome     success
  simulated   true
  duration    65ms
  memories    1 written
  activity    21ac8016-…
```

What just happened, in order:

1. `registry.ts` loaded and validated `agents/web/outreach/auditor.yaml`
2. `prompt.ts` assembled: house rules + the Auditor's role prompt + **14
   memories** retrieved from `global`, `branch.web` and `dept.web.outreach` —
   and nothing from Ateş Flow
3. the tool runner ran with the five tools that config grants it
4. one `activity` row was written, with cost, duration and outcome
5. one `memory` was written back, attributed to the agent and the run
6. the agent's status flipped, which the tree shows on next load

Open `/activity` and it is the first row. Open the Auditor's drawer on `/` and
it is at the top of its log. That loop — config → prompt → tools → activity →
memory → status — is the same one every agent uses.

Add `ANTHROPIC_API_KEY` and step 3 calls a real model instead of a canned one.
Nothing else changes.
