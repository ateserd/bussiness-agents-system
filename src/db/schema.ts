import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ---------------------------------------------------------------------------
   Shared vocabulary.

   These are plain string unions rather than pg enums: an enum change needs a
   migration and a redeploy, and the point of the YAML crew is that adding a
   department or a branch is a file, not a schema change. See README →
   "Adding a third branch".
--------------------------------------------------------------------------- */

export type Branch = "web" | "automation" | "shared";
export type Department = "outreach" | "sales" | "delivery" | "build" | "content" | "shared";
export type Tier = "cos" | "director" | "lead" | "worker";
export type AgentStatus = "idle" | "working" | "blocked" | "needs_approval";
export type Autonomy = "observe" | "propose" | "act_with_log" | "act_freely";
export type Outcome = "success" | "failure" | "blocked" | "needs_approval" | "running";
export type MemoryKind =
  | "fact"
  | "decision"
  | "preference"
  | "client_context"
  | "lesson"
  | "metric_snapshot";

/* ---------------------------------------------------------------------------
   CREW
--------------------------------------------------------------------------- */

export const agents = pgTable(
  "agents",
  {
    /** Dotted path, e.g. "web.outreach.auditor". Matches the YAML filename. */
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    branch: text("branch").$type<Branch>().notNull(),
    department: text("department").$type<Department>().notNull(),
    tier: text("tier").$type<Tier>().notNull(),
    reportsTo: text("reports_to"),
    accent: text("accent").notNull(),
    avatar: text("avatar"),
    status: text("status").$type<AgentStatus>().notNull().default("idle"),
    mission: text("mission").notNull(),
    promptFile: text("prompt_file").notNull(),
    model: text("model").notNull(),
    effort: text("effort").notNull().default("high"),
    tools: jsonb("tools").$type<string[]>().notNull().default([]),
    memoryScopes: jsonb("memory_scopes").$type<string[]>().notNull().default([]),
    approvalRequiredFor: jsonb("approval_required_for").$type<string[]>().notNull().default([]),
    escalateWhen: jsonb("escalate_when").$type<string[]>().notNull().default([]),
    schedule: text("schedule"),
    autonomy: text("autonomy").$type<Autonomy>().notNull().default("propose"),
    paused: boolean("paused").notNull().default(false),
    /** One-line blocker text, set when status = "blocked". */
    blocker: text("blocker"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agents_branch_idx").on(t.branch), index("agents_reports_to_idx").on(t.reportsTo)],
);

export const kpiSnapshots = pgTable(
  "kpi_snapshots",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    label: text("label").notNull(),
    value: real("value").notNull(),
    target: real("target"),
    window: text("window").notNull().default("weekly"),
    /** Date-only key, "YYYY-MM-DD", so a day's value is written once. */
    day: text("day").notNull(),
  },
  (t) => [
    uniqueIndex("kpi_agent_name_day_idx").on(t.agentId, t.name, t.day),
    index("kpi_agent_idx").on(t.agentId),
  ],
);

/* ---------------------------------------------------------------------------
   ACTIVITY — §3 rule 7: everything an agent does writes one row here.
--------------------------------------------------------------------------- */

export const activity = pgTable(
  "activity",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    branch: text("branch").$type<Branch>().notNull(),
    department: text("department").$type<Department>().notNull(),
    /** Machine-ish verb, e.g. "audit_site". */
    action: text("action").notNull(),
    /** One line, Turkish, what happened. */
    summary: text("summary").notNull(),
    /** Why the agent did it. */
    reason: text("reason"),
    input: jsonb("input").$type<Record<string, unknown>>(),
    output: jsonb("output").$type<Record<string, unknown>>(),
    /** §3 rule 8 — the one thing the agent is unsure about. */
    unsureAbout: text("unsure_about"),
    outcome: text("outcome").$type<Outcome>().notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    /** True when the run was produced without calling a model. */
    simulated: boolean("simulated").notNull().default(false),
    taskId: text("task_id"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("activity_started_idx").on(t.startedAt),
    index("activity_agent_idx").on(t.agentId),
    index("activity_outcome_idx").on(t.outcome),
  ],
);

/* ---------------------------------------------------------------------------
   BRAIN — §5.
   Embeddings live in real[] rather than a pgvector column: PGlite 0.5.x does
   not bundle the vector extension, and at this corpus size ranking in JS is
   instant. README documents the swap when the corpus outgrows it.
--------------------------------------------------------------------------- */

export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<MemoryKind>().notNull(),
    /** e.g. ["global"], ["branch.web","dept.sales"], ["client.acme"] */
    scopes: text("scopes").array().notNull(),
    /** One atomic statement. Never a transcript. */
    content: text("content").notNull(),
    sourceAgentId: text("source_agent_id").references(() => agents.id, { onDelete: "set null" }),
    sourceActivityId: text("source_activity_id"),
    sourceUrl: text("source_url"),
    confidence: real("confidence").notNull().default(0.6),
    permanent: boolean("permanent").notNull().default(false),
    embedding: real("embedding").array(),
    useCount: integer("use_count").notNull().default(0),
    /** Set when this memory replaces an older, contradicting one. */
    supersedes: text("supersedes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("memories_kind_idx").on(t.kind), index("memories_created_idx").on(t.createdAt)],
);

export const memoryLinks = pgTable(
  "memory_links",
  {
    id: text("id").primaryKey(),
    fromId: text("from_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    toId: text("to_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    /** "relates" | "supports" | "contradicts" | "supersedes" */
    kind: text("kind").notNull().default("relates"),
  },
  (t) => [uniqueIndex("memory_link_pair_idx").on(t.fromId, t.toId)],
);

/* ---------------------------------------------------------------------------
   WORK QUEUE
--------------------------------------------------------------------------- */

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** "queued" | "running" | "done" | "failed" | "blocked" */
    status: text("status").notNull().default("queued"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    /** Idempotency key: one run per agent per scheduled slot. */
    runKey: text("run_key"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tasks_run_key_idx").on(t.runKey), index("tasks_status_idx").on(t.status)],
);

/** §3 rule 6 — nothing leaves the building without the owner's tap. */
export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    branch: text("branch").$type<Branch>().notNull(),
    /** Which gate tripped, e.g. "sending_external_messages". */
    gate: text("gate").notNull(),
    title: text("title").notNull(),
    /** The full draft the owner is approving, rendered verbatim on the card. */
    draft: text("draft").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>(),
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 2 }),
    /** "pending" | "approved" | "rejected" */
    state: text("state").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    activityId: text("activity_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("approvals_state_idx").on(t.state)],
);

/* ---------------------------------------------------------------------------
   BUSINESS RECORDS
--------------------------------------------------------------------------- */

export const leads = pgTable(
  "leads",
  {
    id: text("id").primaryKey(),
    branch: text("branch").$type<Branch>().notNull(),
    company: text("company").notNull(),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    website: text("website"),
    city: text("city"),
    sector: text("sector"),
    /** 0–100. What the branch's Prospector scored this lead at. */
    fitScore: integer("fit_score").notNull().default(0),
    /** Teardown or dossier the Auditor / Dossier agent produced. */
    thesis: text("thesis"),
    source: text("source"),
    sourceAgentId: text("source_agent_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("leads_branch_idx").on(t.branch)],
);

export const deals = pgTable(
  "deals",
  {
    id: text("id").primaryKey(),
    branch: text("branch").$type<Branch>().notNull(),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    /** "new" | "contacted" | "discovery" | "proposal" | "won" | "lost" */
    stage: text("stage").notNull().default("new"),
    valueUsd: numeric("value_usd", { precision: 12, scale: 2 }).notNull().default("0"),
    /** Recurring component, branch B retainers. */
    mrrUsd: numeric("mrr_usd", { precision: 12, scale: 2 }).notNull().default("0"),
    ownerAgentId: text("owner_agent_id"),
    /** Set by Pipeline Watch when the deal goes quiet. */
    stalled: boolean("stalled").notNull().default(false),
    lastMovedAt: timestamp("last_moved_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deals_branch_stage_idx").on(t.branch, t.stage)],
);

export const clients = pgTable(
  "clients",
  {
    id: text("id").primaryKey(),
    branch: text("branch").$type<Branch>().notNull(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    email: text("email"),
    /** "active" | "at_risk" | "churned" */
    health: text("health").notNull().default("active"),
    mrrUsd: numeric("mrr_usd", { precision: 12, scale: 2 }).notNull().default("0"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
  },
  (t) => [index("clients_branch_idx").on(t.branch)],
);

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    branch: text("branch").$type<Branch>().notNull(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "brief" | "design" | "build" | "qa" | "handoff" | "live" */
    stage: text("stage").notNull().default("brief"),
    /** Branch B: is the shipped automation currently healthy? */
    healthy: boolean("healthy").notNull().default(true),
    atRisk: boolean("at_risk").notNull().default(false),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_branch_idx").on(t.branch)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    branch: text("branch").$type<Branch>().notNull(),
    clientId: text("client_id").references(() => clients.id, { onDelete: "set null" }),
    number: text("number").notNull(),
    amountUsd: numeric("amount_usd", { precision: 12, scale: 2 }).notNull(),
    /** "draft" | "sent" | "paid" | "overdue" */
    state: text("state").notNull().default("sent"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [index("invoices_branch_state_idx").on(t.branch, t.state)],
);

/**
 * Costs the owner enters by hand.
 *
 * There is no accounting integration and no card processor: money arrives as
 * cash or a bank transfer, and goes out the same way. Without this table the
 * LEDGER can only ever show revenue, which is not a P&L — it is half of one,
 * and the flattering half.
 *
 * Agent token spend is not an expense row. It is already counted per run in
 * `activity.cost_usd`, and writing it here too would double it.
 */
export const expenses = pgTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    /** null when the cost belongs to the business rather than to one branch. */
    branch: text("branch").$type<Branch>(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    amountUsd: numeric("amount_usd", { precision: 12, scale: 2 }).notNull(),
    /** true for rent, subscriptions and anything else that repeats monthly. */
    recurring: boolean("recurring").notNull().default(false),
    spentAt: timestamp("spent_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("expenses_branch_spent_idx").on(t.branch, t.spentAt)],
);

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
export type Activity = typeof activity.$inferSelect;
export type NewActivity = typeof activity.$inferInsert;
export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
export type Approval = typeof approvals.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type KpiSnapshot = typeof kpiSnapshots.$inferSelect;
export type Task = typeof tasks.$inferSelect;
