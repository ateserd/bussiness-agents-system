# Mission Control v2 — uygulama planı

> **Durum: onaylandı, uygulama başlamadı.** Bu dosya, v2 yeniden yazımının
> tam planı. Yeni bir oturumda "V2_PLAN.md'den devam et" demen yeterli.

## Nerede kaldık

| Faz | Durum |
|---|---|
| Planlama + kararlar | ✅ bitti (aşağıdaki kararlar sana soruldu, sen seçtin) |
| 0 — Branch/güvenlik | ✅ gerek kalmadı — v1'in tamamı `claude/proje-kalan-gorevler-j5xwv3` olarak GitHub'da duruyor, hiçbir şey kaybolmaz |
| 1 — Yıkım | ⬜ başlanmadı |
| 2 — Runtime temeli | ⬜ başlanmadı |
| 3 — Dört ajan | ⬜ başlanmadı |
| 4 — Entegrasyonlar (kur, Takvim/Meet, web araştırma) | ⬜ başlanmadı |
| 5 — Outreach (toplu onay) | ⬜ başlanmadı |
| 6 — Brifing | ⬜ başlanmadı |
| 7 — UI (önce design canvas) | ⬜ başlanmadı |
| 8 — Deploy + doğrulama | ⬜ başlanmadı |

**Hiçbir kod değişmedi** — bu commit yalnızca planı ekliyor. Çalışan sistem
(v1) VPS'te olduğu gibi ayakta.

## Devam ederken ilk yapılacaklar

1. Faz 1'e başla: 24 ajan YAML + prompt sil, org ağacı bileşenlerini sil,
   `stripe.ts`'i ve çağıranlarını sil, 6 ölü tool adını temizle, `mc-spark`
   keyframe'ini sil, gölgelenmiş `EXTRA_CADENCES` kayıtlarını düzelt,
   `costOf()`'u bilinmeyen modelde 0 yerine hata verecek şekilde düzelt.
2. **Dikkat — veri kaybı uyarısı:** `activity.agent_id → agents.id` ilişkisi
   `ON DELETE CASCADE`. Ajan satırlarını silmek o ajanların geçmiş hareket
   kayıtlarını da siler. v1'de biriken ~17 satırın çoğu bugünkü testler, ama
   silmeden önce sana sorulacak.

## Bu turda alınan kararlar

| Konu | Karar |
|---|---|
| Cold mail onayı | Toplu onay — günün 10 taslağı tek Telegram mesajı, tek "gönder" |
| Takvim/Meet | Kurulacak — gerçek OAuth (senin ~20 dk'lık Google Cloud kurulumun gerekiyor) |
| Kadro | 4 ajan — Yönetici · Scout · Outreach · Ops |
| Silme kapsamı | Hepsi — 24 ajan, org ağacı görseli, Stripe, ölü tool tanımları |

---

# Mission Control v2 — tek yöneticiyle çalışan ajans

## Context

Mission Control today is a 49-agent org *simulation*: a mirrored two-branch
hierarchy (CoS → 2 Directors → 8 department leads → 38 workers) where most
agents never run, six declared tools have no implementation at all, and the
owner is expected to approve work card by card in a dashboard.

Ateş wants the opposite — **one manager he talks to on Telegram that actually
does the work**, a couple of workers under it, and no hardcoded business value
he ever has to edit by hand. The dashboard stops being the control surface and
becomes a live mirror of what the agents are doing.

Decisions taken (asked and answered):

| | |
|---|---|
| Cold mail onayı | **Toplu onay** — günün 10 taslağı tek Telegram mesajı, tek "gönder" |
| Takvim/Meet | **Kurulacak** — gerçek OAuth, Meet linki + davet maili + takvime ekleme |
| Kadro | **4 ajan** — Yönetici · Scout · Outreach · Ops |
| Silme | **Hepsi** — 24 ajan, org ağacı görseli, Stripe, ölü tool tanımları |

## What's actually there today (verified, not assumed)

Findings that shape the plan — several are live bugs:

- **6 declared tools have no implementation.** `agent.dispatch`, `ledger.read`,
  `ledger.write`, `calendar.read`, `crew.propose`, `brain.admin` appear in YAML
  `tools:` lists but are absent from `BUILDERS` in `src/lib/agents/tools.ts`, so
  `toolsFor()` drops them silently. **The Chief of Staff's ability to delegate
  has never existed** — it is a string in a file. This is the single biggest
  gap between what the system claims and what it does.
- **5 of 6 `EXTRA_CADENCES` never fire their own task text.** `dueRuns()`
  dedupes per agent and YAML-derived runs are enumerated first, so
  `leads.end_of_day`, `directors.weekly_review`, `finance.weekly_pl`,
  `brainkeeper.weekly_digest` and `recruiter.monthly` all collide with an
  identical YAML cron and lose to it. Only `cos.evening_wrap` survives.
- **The dashboard's approve button doesn't send email.** `decideApproval()` in
  `src/lib/actions.ts` marks the row approved; only the Telegram `/approve`
  path in `commands.ts` calls `dispatchOutreach()`. Two paths, one outcome —
  a real inconsistency.
- **`CALENDAR_URL` is a read-only `.ics` feed.** It lists today's events; it
  cannot create one and cannot mint a Meet link.
- **No FX conversion exists anywhere.** Every money column is `*_usd numeric`
  and Stripe *refuses* mixed currencies rather than converting. TL is currently
  impossible to express.
- **`costOf()` returns 0 for an unknown model**, silently disabling the cost
  ceiling for a typo'd model name.
- `tasks` already has what a queue needs — `status`, `payload`, `attempts`,
  `lastError`, and a unique `runKey` for minute-granular idempotency. Good
  foundation; it needs a parked state, not a rewrite.

### The email-vs-phone question, settled by what the API actually returns

Google Places returns `nationalPhoneNumber` but **never an email**. Crossed
with the two ICPs already in `places.ts`:

- **Web (Ateş Design)** — `qualifiesForWeb` = *no website* + reviews > 0. A
  business with no website has no discoverable email. → **cold call path is not
  a fallback here, it is the path.** Phone comes straight from Places.
- **Automation (Ateş Flow)** — `passesAutomationFloor` = reviews > 0, website
  allowed. There *is* a site → scrape it with the existing `browser` tool for
  an email. → **cold mail path.**

So "mail varsa mail at, yoksa cold call" is really a branch split, and the
system should say which path a lead is on rather than trying both.

---

## Target architecture

### Four agents, and branch moves off the agent

| id | Ad | İşi |
|---|---|---|
| `shared.command.manager` | **Yönetici** | Tek konuştuğun ajan. Niyeti anlar, görev dağıtır, ayar değiştirir, emin değilse sorar, sabah brifingini yazar. |
| `shared.outreach.scout` | **Scout** | Places'te lead bulur ve nitelendirir; sektör araştırması ve ilham sitesi linkleri çıkarır (web_search + web_fetch). |
| `shared.outreach.writer` | **Outreach** | Cold mail yazar ve (toplu onaydan sonra) gönderir; e-postası olmayan lead için cold call metni çıkarır. Gelen yanıtlara taslak hazırlar — asla kendi cevap yazmaz. |
| `shared.ops.assistant` | **Ops** | Toplantı açar (Meet + davet + takvim), TL→USD çevirir, fatura/gider kaydeder, proje ve fırsat takibini yapar. |

**Branch stops being a property of the agent and becomes a property of the
work.** All four agents are `branch: "shared"`; a *lead, deal, project or
memory* has a branch. The Manager decides which branch a task belongs to and
passes it down. This is what lets 4 agents cover what 49 covered.

Scope isolation survives this, and gets stronger: instead of an agent's fixed
YAML `memory_scopes`, a delegated task carries a branch and the worker runs
with **narrowed scopes for that task only** — `["global","branch.web",
"dept.web.outreach"]` for a web task. `recall()` already takes
`agent: Pick<AgentConfig,"memory_scopes"|"id">`, so this is a narrowed object
at the call site, not a change to the Brain. `assertWritableScopes()` and the
whole scope grammar in `src/lib/brain/scope.ts` stay exactly as they are.

Anything that needs no judgement stops being an agent: stale-deal flagging,
lead retention, quota reset and KPI snapshots become plain functions in the
tick, not LLM calls.

### Runtime core

**Task queue with owner-parking** — `tasks` already has `status`, `payload`,
`attempts`, `lastError` and the unique `runKey`; it needs columns, not a
rewrite. Add `branch`, `question`, `answer`, `askedAt`, `answeredAt`,
`parentTaskId`, `result`, and a `waiting_owner` status.

Flow: Manager `delegate()` inserts a `queued` task → the runner claims it with
a conditional `UPDATE ... WHERE status='queued' RETURNING` (atomic, no new
locking) → the worker runs. If the worker is unsure it calls `ask_owner()`,
which parks *that* task as `waiting_owner`, stores the question, pushes it to
Telegram with a short id, and returns a stop-here string to the model — the
same shape `requireApproval` already uses. **Other queued tasks keep running**;
parking is per-task, which is exactly what was asked for.

Ateş will not type task ids, so resumption is layered: the open questions are
in the Manager's system map, so it infers which one a free-text answer belongs
to and calls `answer_task()`. Deterministic fallbacks underneath: when exactly
one task is parked, any reply resolves it; and `/cevap <id> <metin>` always
works. Never guess between two open questions — ask which.

**Parallel execution** — replace the sequential loop in `tick.ts` with a
bounded pool, limit 3 (setting: `runtime.concurrency`). Each slot has its own
timeout and try/catch, so one failure marks one task `failed` and touches
nothing else. They run the systemd timer, not serverless, so there is no
function-timeout ceiling; `/api/tick` keeps its existing documented caveat.

*Race this exposes*: `runAgent` writes `agents.status = "working"` then back.
With one agent running two tasks at once that column flaps and lies. Fix:
**"is it working" moves from the agent row to the task rows** — the UI reads
running tasks. `paused` stays on the agent. This also kills the unreliable
"working" glow the old tree had.

**Manager authority.** The real `delegate` tool (the `agent.dispatch` that
never existed):

```ts
delegate({ agent: "scout"|"outreach"|"ops", title, instruction, branch?, }): Promise<{taskId}>
```

Fire-and-forget only. A Manager blocking inside its own run to await a worker
burns tokens and can hit `MAX_ITERATIONS`; instead it returns "başlattım", and
the worker notifies the owner itself on completion.

Typed settings, so no business value is hardcoded:

```ts
// new table: key PK, value text, type, allowed jsonb, min/max, label (TR),
//            owner_confirm bool, updatedAt, updatedBy
export async function getSetting<T>(key: string, fallback: T): Promise<T>;
export async function setSetting(key: string, raw: string, by: string): Promise<Result>;
export async function allSettings(): Promise<SettingRow[]>;
```

Every read passes a hardcoded fallback, so the table is an override layer and
an unseeded key can never break a code path. Seed covers
`outreach.daily_cap_per_mailbox=10`, `outreach.approval_mode="batch"`,
`lead.stale_days=14`, `client.quiet_days=30`, `brief.time="07:30"`,
`fx.source="tcmb"`, `escalation.ceiling_usd=0`, `runtime.concurrency=3` and the
rest of the values currently frozen in YAML and prose.

`buildSystemMap()` — one compact block appended **after** the stable role
prompt so the cacheable prefix stays intact:

```
AJANLAR    scout(places,web_search) · outreach(mail,call_script) · ops(takvim,para)
AYARLAR    günlük_mail=10 · bayat_gün=14 · brifing=07:30 · kur=tcmb
GÖREVLER   3 çalışıyor · 1 sana takılı (#a4f2c1 "Kumsal Balık'a hangi fiyat?")
KAYNAKLAR  resend✓ places✓ takvim✗(OAuth yok) kur✓
RAKAMLAR   12 lead · 3 açık fırsat · 2 canlı proje
```

~200 tokens, rebuilt per run. This is what "ajan tüm sistemi tanımalı" means
concretely.

**Telegram loop, inverted.** Today `parseCommand` switches on slash commands
and free text falls through to `ask`. That flips: free text is the primary path
into the Manager (chat mode), and slash commands survive as a fast path
(`/brief`, `/blockers`, `/approve`, `/cevap`). Voice notes already converge on
the same parser after transcription — unchanged.

**Batch approval.** Drafts still become `approvals` rows (keeps the audit trail
and the schema), but `requireApproval` gains `notify: false` so batch items
don't each ping. A job at `outreach.batch_time` renders one numbered Telegram
message — company + a ~150-char slice of each draft, total held under the 4096
limit — and stores the batch→approval-id map in `tasks.payload`. The Manager
interprets the reply (`gönder`, `3 hariç`, `1,2,5`, `iptal`) and settles them.

**And it unifies the two approve paths.** `decideApproval()` (dashboard) and
`/approve` (chat) both get replaced by one `settleApproval(id, decision,
reason?)` in a new `src/lib/approvals.ts` that marks the row *and* dispatches —
fixing the live bug where approving in the dashboard silently never sends.

---

## New integrations

### FX — `src/lib/integrations/fx.ts` (new)

TCMB's daily rate XML (`https://www.tcmb.gov.tr/kurlar/today.xml`) — free, no
key, and the rate a Turkish accountant would actually use. Cache per day.

```ts
export type Rate = { ok: true; usdTry: number; asOf: Date } | { ok: false; reason: string };
export async function usdTryRate(): Promise<Rate>;
export async function tryToUsd(amountTry: number): Promise<{ ok: true; usd: number; rate: number; asOf: Date } | { ok: false; reason: string }>;
```

Weekends/holidays return the last business day's rate, which is correct
behaviour, not staleness — but the `asOf` date must be shown so it's never
mistaken for today's. Unreachable → `⚠️ TCMB kullanılamıyor (<reason>)`, never
a guessed rate.

**Constraint found while planning:** this dev sandbox's egress proxy blocks
`tcmb.gov.tr` *and* every public FX API I tried (`open.er-api.com`,
`exchangerate.host`, `frankfurter.app` — all connection-refused). So the XML
shape cannot be verified here and **FX is only testable on the VPS.** Two
consequences: parse defensively and fail loudly rather than assuming the
documented field names, and make the source a setting (`fx.source`) so if TCMB
proves flaky Ateş can switch it by telling the Manager — the no-hardcoded-values
principle applied to itself. Locally this correctly shows `⚠️ TCMB
kullanılamıyor`, which is the existing house rule working as designed.

Wired into: a `money` tool for Ops, and `/remember`-style parsing so "bu proje
45 bin TL" is stored as USD with the rate and date recorded alongside.

### Google Calendar + Meet — `src/lib/integrations/google-calendar.ts` (new)

OAuth2 refresh-token flow (not the read-only `.ics`). Scope:
`https://www.googleapis.com/auth/calendar.events`.

```ts
export function calendarWriteConfigured(): boolean;
export async function createMeeting(o: {
  title: string; startsAt: Date; durationMin: number;
  attendeeEmails: string[]; description?: string;
}): Promise<{ ok: true; eventId: string; meetUrl: string; htmlLink: string } | { ok: false; reason: string }>;
export async function listUpcoming(days: number): Promise<...>;
```

Meet link comes from `events.insert` with `conferenceData.createRequest` and
`conferenceDataVersion=1`. Google sends the invite email to attendees itself,
so Ops does not also send one through Resend — that would double-mail the
client. Ops *does* send a separate Resend follow-up only when the owner asks
for one with extra context.

**Setup Ateş has to do once (~20 min), written out for him at build time:**
1. Google Cloud Console → same project as the Places key → enable **Google Calendar API**
2. OAuth consent screen → External → add his own Gmail as a test user
3. Credentials → Create OAuth client ID → **Desktop app**
4. Run a one-shot `npm run google:auth` script (built as part of this work): it
   prints an auth URL, he pastes back the code, it prints the refresh token
5. Paste `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`,
   `GOOGLE_CALENDAR_ID` into `.env`, restart

The existing `.ics` `CALENDAR_URL` path stays as a fallback for reading, so
the brief keeps working if OAuth isn't finished yet.

### Web research — no new key

Anthropic's server-side tools `web_search_20260209` and `web_fetch_20260209`
(supported on Sonnet 5, which every agent now runs). Declared straight in the
`tools` array alongside the Zod tools — no client-side execution, no extra
provider. Scout uses these for sector research and inspiration-site links.

*Verified*: the installed SDK (`@anthropic-ai/sdk` 0.120.0) carries both
`web_search_20260209` and `web_fetch_20260209` types, so this needs no upgrade.

Two known hazards, both already handled in `run.ts`: the tool runner does not
auto-resume `pause_turn` (the existing loop pushes the paused turn back), and
these tools run code under the hood, so `code_execution` must **not** also be
declared.

---

## Outreach, reworked

Daily flow, all settings-driven (`outreach.daily_cap_per_mailbox`, default 10):

1. **Scout** finds and qualifies leads → `leads` rows with branch, phone,
   website, review count, fit score.
2. **Outreach** picks the day's N leads. Per the branch split above: web-branch
   leads (no site) get a **cold-call script + phone**; automation-branch leads
   get their site scraped for an email and a **cold mail draft**.
3. Drafts are written to `approvals` as today (one row each — keeps the audit
   trail and the existing schema) but **not** notified individually.
4. One batch message goes to Telegram: numbered list, each with company + one
   line of the draft, under the 4096-char limit with the full text available on
   request. Cold-call items are in the same message with the phone number,
   marked as "sen arayacaksın" — no approval needed for those, they're for him.
5. He replies once. `gönder` / `hepsi` sends all; `3 hariç gönder` or `1,2,5
   gönder` are understood; `iptal` rejects the batch.
6. Sending reuses `dispatchOutreach()`, which already writes a real activity
   row per send.

**On the unconditional gate.** `outreach_send` today calls `requireApproval`
with no `gatedBy` check by deliberate design — so that deleting a gate from
YAML or setting `act_freely` can never open a path to a stranger's inbox. Batch
approval **keeps that guarantee**: nothing sends without an explicit human
"gönder" for that specific batch. What changes is only the *granularity* of the
approval (one message instead of ten), not whether one is required. The code
comment saying so must be updated to describe the batch, not per-message,
so the next reader isn't misled.

---

## Morning brief, reworked

`src/lib/brief.ts` stays deterministic for numbers (never estimated) but gains
what Ateş asked for — active, past *and* potential projects:

- **Aktif**: live projects, stage, days to due date, at-risk flag
- **Geçmiş**: clients gone quiet past `client.quiet_days`, with last contact —
  the "hatırlat" half of the request
- **Potansiyel**: open deals by stage, stalled ones named, today's batch size
- **Bugün**: meetings from Calendar (Meet links inline), today's send count
- **Sana düşenler**: parked questions first, then approvals, capped at 3

The prose framing around the numbers is written by the **Manager** (it already
has a chat register from `CHAT_HOUSE_RULES`); the numbers are injected, never
generated. Keeps the never-fabricate rule intact while losing the robot tone.

---

## UI — a mirror, not a cockpit

Control moves to Telegram, so the dashboard's job changes: it is read at a
glance to answer "ne oluyor?", not operated. That reframing is what makes it
less confusing, more than any restyling.

**Four views, plain Turkish nouns** (replacing COMMAND/BRAIN/ACTIVITY/LEDGER):

| View | İçerik |
|---|---|
| **Bugün** | Şu an çalışan görevler · sana takılı sorular · bugünkü toplantılar · bugünkü gönderim partisi · son hareketler · brifing |
| **Hat** | Lead → fırsat → proje → müşteri hunisi, şube etiketiyle |
| **Para** | Şube başına P&L, tahsilat, ödenmemiş, ajan maliyeti, 12 haftalık seyir |
| **Hafıza** | Beyin — takımyıldız korunuyor |

Deleted: the 49-node org tree (`command/org-tree.tsx`, `nodes.tsx`,
`cable.tsx`, `layout.ts`) — a tree of four nodes carries no information.
Replaced on **Bugün** by a live task board.

**Live for real.** Today "live" is theatre: breathing dots and a travelling
cable dot over static server-rendered state, with no polling anywhere. A small
`/api/state` endpoint (counts, running tasks, parked questions, last activity
id) polled every 5s, with `router.refresh()` when the payload's version changes.
Cheap, and honest.

**What the UI stops being able to do** — flagged because it removes buttons
that exist today. "UI üzerinden kontrol edilmektense Telegram üzerinden" means
the agent controls go: *Şimdi çalıştır*, *Duraklat/Sürdür*, and per-card
*Onayla/Reddet* are all things you now say to the Manager instead (and batch
approval has no sensible per-card button anyway — the approval tray becomes a
read-only "10 taslak Telegram'da bekliyor"). **The Brain's delete and add-note
stay**, because those were asked for explicitly earlier and are editing memory,
not commanding an agent. Say so if that trade isn't wanted.

**Design pass — first task of the UI phase, before any component is written:**
run the `design` skill to produce a design canvas of the four views, so the
visual direction is agreed on a page rather than argued in code. Direction:

- *Cut*: the starfield, `mc-breathe` / `mc-breathe-red` / `mc-ring-gold` glow
  animations, the travelling cable dot, the radial gold hero glow, the dead
  `mc-spark` keyframe, and five of the six department neon accents. These are
  exactly the markers that read as generated.
- *Keep*: the dark ground and gold — that's their identity, not slop — plus
  Archivo + IBM Plex Mono.
- *Fix the type crime*: `.mc-eyebrow` (10.5px uppercase mono, 0.2em tracking)
  is currently the most-used class in the app and is applied to labels that
  should be plain readable text. Mono gets restricted to numbers, ids and
  timestamps; labels become sentence-case Archivo.
- *Add what's missing*: there is no spacing, radius, shadow or type scale, and
  25+ hardcoded `rgba()` literals duplicate token values. Real tokens, one
  accent, semantic colour (ok/warn/crit) kept separate from accent.
- *Motion only on real state change* — a task actually running gets an
  indicator; nothing else moves.

---

## Build order

Each phase ends green (typecheck + lint + build) and deployable.

0. **Branch + safety.** New branch off current. Old system stays on GitHub —
   nothing is unrecoverable.
1. **Demolition.** Delete 24 agent YAMLs + their prompts, the org-tree
   components, `stripe.ts` and its call sites, the 6 dead tool names, the dead
   `mc-spark` keyframe, and the shadowed `EXTRA_CADENCES` entries. Fix
   `costOf()` to refuse unknown models instead of returning 0.
2. **Foundation.** `settings` table + tools, `tasks` parked state, parallel
   runner, `delegate` tool, `buildSystemMap()`, per-task scope narrowing.
3. **The four agents.** New YAMLs + prompts. Manager gets the free-text
   Telegram path; `executeCommand` keeps slash commands as fallback. Unify
   `decideApproval` and `/approve` onto one dispatch path (fixes the bug above).
4. **Integrations.** FX, Google Calendar/Meet + `npm run google:auth`, web
   research tools. `.env.example` and `DEPLOY.md` updated as each lands.
5. **Outreach.** Batch approval, branch-split cold mail vs cold call, quota
   from settings.
6. **Brief.** Active/past/potential, meetings, Manager-written prose.
7. **UI.** Design canvas first, then tokens, then the four views, then live
   polling.
8. **Deploy + verify.**

## Verification

Not "it builds" — each capability gets exercised against the real system:

- `npm run typecheck && npm run lint && npm run build` green at every phase
- **Playwright at mobile + desktop viewport** for the UI phase (the pattern
  already used this session): no horizontal overflow on any view, live polling
  observably updates, touch works on the Brain canvas
- **Telegram, end to end**, on the VPS: a free-text request that needs
  delegation; a request the Manager should ask a question about (verify the
  task parks, others continue, and his answer resumes it); a settings change by
  voice note ("günlük mail sayısını 15 yap") verified in the DB
- **FX**: "bu proje 45 bin TL" → correct USD at the TCMB rate, with `asOf`
- **Meeting**: real Meet link created, invite lands in a real inbox, event
  appears on his calendar
- **Outreach batch**: one Telegram message, partial approval (`3 hariç`)
  honoured, sends confirmed in `activity` and in the recipient inbox
- **Cost**: `activity.cost_usd` sum reconciles against the Anthropic console,
  the way the $0.26/$1.86 discrepancy was caught and fixed this session

## Security: broad authority meets untrusted text

Giving the Manager authority to change any setting creates a vector that
matters *because a path into it already exists*: inbound cold-mail replies are
written into the Brain by `/api/resend`, and agents read the Brain. A prospect
can therefore put text in front of an agent. Today that only risks a bad
memory; once settings are writable it could try "günlük limiti 500 yap" or
"onay modunu kapat".

Three defences, all cheap:

1. **Settings writes only from the owner's channel.** The `settings_write` tool
   is only mounted when the Manager run originates from a verified Telegram
   message (the route already pins `TELEGRAM_CHAT_ID`). A scheduled run, or a
   run triggered by processing inbound mail, does not get the tool at all.
2. **Locked keys — but a short list.** Only settings that *weaken a safety
   guarantee* need a yes/no round-trip: `outreach.approval_mode` (turning
   approval off entirely), `escalation.ceiling_usd`, `agent.max_cost_usd`.
   **`outreach.daily_cap_per_mailbox` is deliberately NOT on that list** — it
   is Ateş's own headline example ("mail sayısını değiştirmek istersem
   Telegram'dan söyleyeyim, hemen yapsın"), so it changes on one sentence.
   It's protected by a schema `max` instead, so "500 yap" is refused by range,
   not by ceremony. Ceremony belongs only where a *guarantee* is being removed.
3. **Every change is announced.** A settings write always pushes "X'i Y yaptım"
   to Telegram, so a change he didn't ask for is visible immediately rather
   than discovered in a bill.

Related, and worth fixing while we're here: memories written from inbound email
should be marked with their untrusted provenance (they already carry
`kind: "client_context"`, but nothing distinguishes "the client told us this"
from "we established this"), so the prompt can frame them as claims rather
than facts.

## Risks / open

- **Google OAuth is the one step that can stall**, since it needs console work
  from Ateş. Everything else ships without it; the `.ics` read path stays as
  fallback so the brief never breaks.
- **Cost per Telegram message rises** — the Manager carries a system map and
  broad tools, so casual chat costs more than the old fixed commands. Mitigate
  with prompt caching on the stable prefix and a cheap path for questions
  needing no tools. Watch it on **Para** in week one; the cost plumbing is
  trustworthy now that the shared-agent gap is fixed.
- **FX can't be verified before the VPS** (egress blocked here), so treat the
  first real TL conversion as a checkpoint, not a formality.
- A 4-agent system concentrates a lot in one prompt. If the Manager starts
  getting confused, the fix is splitting Scout's research half back out (the
  5-agent option), not piling more rules into the prompt.
- **The two-branch model survives on the data but not in the org.** If it turns
  out he actually wants the branches to behave differently in *process* (not
  just be labelled), that's a bigger change than this plan makes — worth
  watching in the first weeks.
