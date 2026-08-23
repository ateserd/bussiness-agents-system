import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { copy } from "@/lib/copy";
import {
  activity,
  agents,
  approvals,
  clients,
  deals,
  expenses,
  invoices,
  kpiSnapshots,
  memories,
  memoryLinks,
  projects,
  type Activity,
  type Agent,
  type Approval,
  type Branch,
  type KpiSnapshot,
  type Memory,
} from "@/db/schema";

/**
 * Every read the views make. Server Components call these directly; nothing in
 * here is client-safe (it touches the database).
 */

export type AgentNode = Agent & {
  kpis: { name: string; label: string; value: number; target: number | null; series: number[] }[];
  lastActivity: Activity | null;
};

export async function getCrew(): Promise<AgentNode[]> {
  const db = await getDb();
  const [rows, kpis, recent] = await Promise.all([
    db.select().from(agents),
    db.select().from(kpiSnapshots).orderBy(kpiSnapshots.day),
    db
      .select()
      .from(activity)
      .orderBy(desc(activity.startedAt))
      .limit(600),
  ]);

  const kpisByAgent = new Map<string, KpiSnapshot[]>();
  for (const k of kpis) {
    const list = kpisByAgent.get(k.agentId) ?? [];
    list.push(k);
    kpisByAgent.set(k.agentId, list);
  }

  const lastByAgent = new Map<string, Activity>();
  for (const a of recent) {
    // agentId is nullable now: a row whose agent was deleted is still real
    // history, but it is nobody's "last activity".
    if (a.agentId && !lastByAgent.has(a.agentId)) lastByAgent.set(a.agentId, a);
  }

  return rows.map((agent) => {
    const snaps = kpisByAgent.get(agent.id) ?? [];
    const byName = new Map<string, KpiSnapshot[]>();
    for (const s of snaps) {
      const list = byName.get(s.name) ?? [];
      list.push(s);
      byName.set(s.name, list);
    }
    return {
      ...agent,
      kpis: [...byName.entries()].map(([name, series]) => ({
        name,
        label: series[0].label,
        value: series[series.length - 1]?.value ?? 0,
        target: series[0].target,
        series: series.map((s) => s.value),
      })),
      lastActivity: lastByAgent.get(agent.id) ?? null,
    };
  });
}

export async function getAgentDetail(id: string) {
  const db = await getDb();
  const [[agent], log, mem, kpis] = await Promise.all([
    db.select().from(agents).where(eq(agents.id, id)),
    db.select().from(activity).where(eq(activity.agentId, id)).orderBy(desc(activity.startedAt)).limit(12),
    db.select().from(memories).where(eq(memories.sourceAgentId, id)).orderBy(desc(memories.createdAt)).limit(12),
    db.select().from(kpiSnapshots).where(eq(kpiSnapshots.agentId, id)).orderBy(kpiSnapshots.day),
  ]);
  return { agent: agent ?? null, log, memories: mem, kpis };
}

export async function getMemoryCount(): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(memories);
  return row?.n ?? 0;
}

export type PendingApproval = Approval & { agentName: string };

export async function getPendingApprovals(): Promise<PendingApproval[]> {
  const db = await getDb();
  const rows = await db
    .select({ approval: approvals, agentName: agents.displayName })
    .from(approvals)
    .innerJoin(agents, eq(agents.id, approvals.agentId))
    .where(eq(approvals.state, "pending"))
    .orderBy(desc(approvals.createdAt));
  return rows.map((r) => ({ ...r.approval, agentName: r.agentName }));
}

export type ActivityRow = Activity & { agentName: string; accent: string };

export async function getActivity(limit = 200): Promise<ActivityRow[]> {
  const db = await getDb();
  // leftJoin, not innerJoin: `activity.agent_id` is nullable so that history
  // survives the agent that made it. An innerJoin here would hide precisely
  // those rows and quietly undo the point of keeping them.
  const rows = await db
    .select({ a: activity, agentName: agents.displayName, accent: agents.accent })
    .from(activity)
    .leftJoin(agents, eq(agents.id, activity.agentId))
    .orderBy(desc(activity.startedAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r.a,
    agentName: r.agentName ?? copy.activity.deletedAgent,
    accent: r.accent ?? "#5b6d85",
  }));
}

/* ---------------------------------------------------------------------------
   LEDGER
--------------------------------------------------------------------------- */

export type BranchLedger = {
  branch: Branch;
  revenueMtd: number;
  cashCollected: number;
  /** Hand-entered costs for the month. Agent token spend is not counted here. */
  expensesMtd: number;
  /** revenue − expenses − agent cost. The half of the P&L that was missing. */
  netMtd: number;
  pipelineValue: number;
  liveProjects: number;
  unpaidInvoices: number;
  unpaidCount: number;
  agentCostMtd: number;
  /** Set when a required integration is missing — §3 rule 3. */
  unavailable: { field: string; reason: string }[];
};

const MONTH_START = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

export async function getLedger(): Promise<{
  branches: BranchLedger[];
  weekly: { week: string; web: number; automation: number }[];
}> {
  const db = await getDb();
  const monthStart = MONTH_START();

  const [invoiceRows, dealRows, projectRows, costRows, expenseRows] = await Promise.all([
    db.select().from(invoices),
    db.select().from(deals),
    db.select().from(projects),
    db
      .select({
        branch: activity.branch,
        total: sql<string>`coalesce(sum(${activity.costUsd}), 0)`,
      })
      .from(activity)
      .where(gte(activity.startedAt, monthStart))
      .groupBy(activity.branch),
    db.select().from(expenses).where(gte(expenses.spentAt, monthStart)),
  ]);

  const costByBranch = new Map(costRows.map((r) => [r.branch, Number(r.total)]));
  // shared.* agents (Chief of Staff, Brain Keeper, ...) run both branches at
  // once — same story as the expenses below, split in half rather than owned
  // by neither or double-counted in Combined.
  const sharedAgentCost = costByBranch.get("shared") ?? 0;

  // Branch-less expenses — the accountant, bank fees — belong to the business,
  // not to either P&L, so they are split evenly rather than landing on whichever
  // branch happens to be listed first.
  const shared = expenseRows.filter((e) => !e.branch).reduce((n, e) => n + Number(e.amountUsd), 0);
  const expenseByBranch = new Map<string, number>();
  for (const branch of ["web", "automation"]) {
    const own = expenseRows
      .filter((e) => e.branch === branch)
      .reduce((n, e) => n + Number(e.amountUsd), 0);
    expenseByBranch.set(branch, own + shared / 2);
  }

  // Money arrives as cash or a bank transfer and is entered by hand, so the
  // recorded payments *are* the source of truth — not a stand-in for one. That
  // is the whole model now: the payment-processor path was removed rather than
  // left dangling, because one is never going to be wired here.

  const branches: BranchLedger[] = (["web", "automation"] as const).map((branch) => {
    const inv = invoiceRows.filter((i) => i.branch === branch);
    const collected = inv
      .filter((i) => i.state === "paid" && i.paidAt && i.paidAt >= monthStart)
      .reduce((n, i) => n + Number(i.amountUsd), 0);
    const unpaid = inv.filter((i) => i.state === "sent" || i.state === "overdue");
    const open = dealRows.filter(
      (d) => d.branch === branch && !["won", "lost"].includes(d.stage),
    );

    // Currently always empty: the only source that ever filled it is gone.
    // Kept because it is the §3-rule-3 carrier — a field is reported as
    // unavailable-with-a-reason rather than shown as a confident zero — and
    // the FX and Calendar sources land in it next.
    const unavailable: { field: string; reason: string }[] = [];

    const expensesMtd = expenseByBranch.get(branch) ?? 0;
    const revenueMtd = collected;
    const agentCostMtd = (costByBranch.get(branch) ?? 0) + sharedAgentCost / 2;

    return {
      branch,
      revenueMtd,
      cashCollected: collected,
      expensesMtd,
      // Revenue less what it cost to earn: hand-entered expenses plus the token
      // spend already recorded per run. Without the expense side this was
      // revenue wearing a profit label.
      netMtd: revenueMtd - expensesMtd - agentCostMtd,
      pipelineValue: open.reduce((n, d) => n + Number(d.valueUsd), 0),
      liveProjects: projectRows.filter((p) => p.branch === branch).length,
      unpaidInvoices: unpaid.reduce((n, i) => n + Number(i.amountUsd), 0),
      unpaidCount: unpaid.length,
      agentCostMtd,
      unavailable,
    };
  });

  // 12 weeks of collected cash, per branch.
  const weekly: { week: string; web: number; automation: number }[] = [];
  for (let w = 11; w >= 0; w--) {
    const end = new Date(Date.now() - w * 7 * 86_400_000);
    const start = new Date(end.getTime() - 7 * 86_400_000);
    const inRange = invoiceRows.filter(
      (i) => i.state === "paid" && i.paidAt && i.paidAt >= start && i.paidAt < end,
    );
    weekly.push({
      week: `${start.getDate()}.${start.getMonth() + 1}`,
      web: inRange.filter((i) => i.branch === "web").reduce((n, i) => n + Number(i.amountUsd), 0),
      automation: inRange
        .filter((i) => i.branch === "automation")
        .reduce((n, i) => n + Number(i.amountUsd), 0),
    });
  }

  return { branches, weekly };
}

/* ---------------------------------------------------------------------------
   BRAIN
--------------------------------------------------------------------------- */

export type BrainNode = {
  id: string;
  kind: Memory["kind"];
  content: string;
  scopes: string[];
  branch: Branch | "global";
  department: string | null;
  confidence: number;
  permanent: boolean;
  useCount: number;
  sourceAgentId: string | null;
  sourceAgentName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  supersedes: string | null;
};

export async function getBrain(): Promise<{
  nodes: BrainNode[];
  links: { from: string; to: string; kind: string }[];
  counts: { memories: number; facts: number; clients: number; links: number };
}> {
  const db = await getDb();
  const [rows, links, agentRows] = await Promise.all([
    db.select().from(memories),
    db.select().from(memoryLinks),
    db.select({ id: agents.id, name: agents.displayName }).from(agents),
  ]);
  const nameById = new Map(agentRows.map((a) => [a.id, a.name]));

  const nodes: BrainNode[] = rows.map((m) => {
    const branchScope = m.scopes.find((s) => s.startsWith("branch."));
    const deptScope = m.scopes.find((s) => s.startsWith("dept."));
    return {
      id: m.id,
      kind: m.kind,
      content: m.content,
      scopes: m.scopes,
      branch: branchScope ? ((branchScope.split(".")[1] as Branch) ?? "global") : "global",
      // Scopes are branch-qualified ("dept.web.outreach"), so the department is
      // the last segment, not the second.
      department: deptScope ? deptScope.split(".").at(-1)! : null,
      confidence: m.confidence,
      permanent: m.permanent,
      useCount: m.useCount,
      sourceAgentId: m.sourceAgentId,
      sourceAgentName: m.sourceAgentId ? (nameById.get(m.sourceAgentId) ?? null) : null,
      createdAt: m.createdAt.toISOString(),
      lastUsedAt: m.lastUsedAt?.toISOString() ?? null,
      supersedes: m.supersedes,
    };
  });

  const clientScopes = new Set<string>();
  for (const m of rows) {
    for (const s of m.scopes) if (s.startsWith("client.")) clientScopes.add(s);
  }

  return {
    nodes,
    links: links.map((l) => ({ from: l.fromId, to: l.toId, kind: l.kind })),
    counts: {
      memories: nodes.length,
      facts: nodes.filter((n) => n.permanent).length,
      clients: clientScopes.size,
      links: links.length,
    },
  };
}

/* ---------------------------------------------------------------------------
   BRIEF inputs
--------------------------------------------------------------------------- */

export async function getBriefData() {
  const db = await getDb();
  const [dealRows, projectRows, invoiceRows, blocked, pending, clientRows] = await Promise.all([
    db.select().from(deals),
    db.select().from(projects),
    db.select().from(invoices),
    db.select().from(agents).where(eq(agents.status, "blocked")),
    db.select().from(approvals).where(eq(approvals.state, "pending")),
    db.select().from(clients),
  ]);
  return { deals: dealRows, projects: projectRows, invoices: invoiceRows, blocked, pending, clients: clientRows };
}

export async function getBlockedAgents(): Promise<Agent[]> {
  const db = await getDb();
  return db.select().from(agents).where(and(eq(agents.status, "blocked")));
}
