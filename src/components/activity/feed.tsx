"use client";

import { useMemo, useState } from "react";
import { copy, fmt } from "@/lib/copy";
import type { ActivityRow, PendingApproval } from "@/lib/data";
import type { Agent } from "@/db/schema";

const OUTCOMES = ["success", "failure", "blocked", "needs_approval"] as const;

function outcomeColor(outcome: string): string {
  if (outcome === "failure" || outcome === "blocked") return "var(--crit)";
  if (outcome === "needs_approval") return "var(--gold)";
  if (outcome === "running") return "var(--sales)";
  return "var(--ok)";
}

export function ActivityFeed({
  rows,
  approvals,
  blocked,
}: {
  rows: ActivityRow[];
  approvals: PendingApproval[];
  blocked: Agent[];
}) {
  const [branch, setBranch] = useState("all");
  const [department, setDepartment] = useState("all");
  const [agent, setAgent] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const departments = useMemo(
    () => [...new Set(rows.map((r) => r.department))].sort(),
    [rows],
  );
  const agentNames = useMemo(
    () =>
      [...new Map(rows.map((r) => [r.agentId, r.agentName])).entries()].sort((a, b) =>
        a[1].localeCompare(b[1]),
      ),
    [rows],
  );

  const filtered = rows.filter(
    (r) =>
      (branch === "all" || r.branch === branch) &&
      (department === "all" || r.department === department) &&
      (agent === "all" || r.agentId === agent) &&
      (outcome === "all" || r.outcome === outcome),
  );

  return (
    <div className="flex flex-col gap-8 px-7 pb-16">
      {/* pinned: needs approval + blocked */}
      {(approvals.length > 0 || blocked.length > 0) && (
        <section className="grid gap-4 lg:grid-cols-2">
          <Pinned
            title={copy.command.approvalTray}
            accent="var(--gold)"
            empty={copy.command.noApprovals}
            items={approvals.map((a) => ({
              id: a.id,
              head: `${a.agentName} · ${a.gate}`,
              body: a.title,
              meta: fmt.ago(a.createdAt),
            }))}
          />
          <Pinned
            title={copy.command.blockedTray}
            accent="var(--crit)"
            empty={copy.command.noBlocked}
            items={blocked.map((b) => ({
              id: b.id,
              head: b.displayName,
              body: b.blocker ?? "—",
              meta: fmt.ago(b.lastRunAt),
            }))}
          />
        </section>
      )}

      {/* filters */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Filter label={copy.activity.filterBranch} value={branch} onChange={setBranch}
          options={[["all", copy.activity.all], ["web", copy.branch.web], ["automation", copy.branch.automation], ["shared", copy.branch.sharedFull]]} />
        <Filter label={copy.activity.filterDepartment} value={department} onChange={setDepartment}
          options={[["all", copy.activity.all], ...departments.map((d) => [d, copy.department[d as keyof typeof copy.department] ?? d] as [string, string])]} />
        <Filter label={copy.activity.filterAgent} value={agent} onChange={setAgent}
          options={[["all", copy.activity.all], ...agentNames.map(([id, name]) => [id, name] as [string, string])]} />
        <Filter label={copy.activity.filterOutcome} value={outcome} onChange={setOutcome}
          options={[["all", copy.activity.all], ...OUTCOMES.map((o) => [o, copy.outcome[o]] as [string, string])]} />
        <p className="mc-eyebrow ml-auto" style={{ fontSize: 10 }}>
          {fmt.number(filtered.length)} / {fmt.number(rows.length)} kayıt
        </p>
      </div>

      {/* feed */}
      {filtered.length === 0 ? (
        <p className="text-[14px]" style={{ color: "var(--dim)" }}>
          {copy.activity.empty}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {filtered.map((row) => {
            const open = expanded === row.id;
            return (
              <li
                key={row.id}
                className="grid grid-cols-[auto_1fr_auto] items-start gap-x-4 gap-y-1 py-3"
                style={{ borderBottom: "1px solid var(--line)" }}
              >
                <span
                  className="mc-num mt-[3px] whitespace-nowrap text-[10.5px]"
                  style={{ color: "var(--dim)" }}
                >
                  {fmt.date(row.startedAt)}
                </span>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span
                      className="inline-block h-[6px] w-[6px] flex-none rounded-full"
                      style={{ background: row.accent }}
                    />
                    <span className="text-[12.5px] font-semibold">{row.agentName}</span>
                    <span className="mc-eyebrow" style={{ fontSize: 9 }}>
                      {row.action}
                    </span>
                    <span
                      className="mc-eyebrow"
                      style={{ fontSize: 9, color: outcomeColor(row.outcome) }}
                    >
                      {copy.outcome[row.outcome as keyof typeof copy.outcome] ?? row.outcome}
                    </span>
                    {row.simulated && (
                      <span className="mc-eyebrow" style={{ fontSize: 9, color: "var(--dim)" }}>
                        {copy.activity.simulated}
                      </span>
                    )}
                  </div>
                  <p className="mb-0 mt-1 text-[13.5px] leading-snug">{row.summary}</p>

                  {open && (
                    <div className="mt-3 flex flex-col gap-3 rounded px-4 py-3" style={{ background: "rgba(0,0,0,.24)", border: "1px solid var(--line)" }}>
                      {row.reason && (
                        <Detail label={copy.activity.reason} value={row.reason} />
                      )}
                      {row.unsureAbout && (
                        <Detail label={copy.activity.unsure} value={row.unsureAbout} accent="var(--gold)" />
                      )}
                      {row.error && <Detail label="Hata" value={row.error} accent="var(--crit)" />}
                      <Detail label={copy.activity.input} value={JSON.stringify(row.input ?? {}, null, 1)} mono />
                      <Detail label={copy.activity.output} value={JSON.stringify(row.output ?? {}, null, 1)} mono />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <span className="mc-num whitespace-nowrap text-[10.5px]" style={{ color: "var(--dim)" }}>
                    {fmt.cost(Number(row.costUsd))} · {fmt.duration(row.durationMs)}
                  </span>
                  <button
                    onClick={() => setExpanded(open ? null : row.id)}
                    aria-expanded={open}
                    className="rounded border px-1.5 font-mono text-[11px] leading-5"
                    style={{ borderColor: "var(--line)", color: "var(--haze)" }}
                  >
                    {open ? "−" : "›"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Pinned({
  title,
  accent,
  empty,
  items,
}: {
  title: string;
  accent: string;
  empty: string;
  items: { id: string; head: string; body: string; meta: string }[];
}) {
  return (
    <div
      className="rounded p-5"
      style={{ border: "1px solid var(--line)", borderTop: `2px solid ${accent}`, background: "var(--panel)" }}
    >
      <p className="mc-eyebrow mb-3.5" style={{ color: accent }}>
        {title} · {items.length}
      </p>
      {items.length === 0 ? (
        <p className="m-0 text-[13px]" style={{ color: "var(--dim)" }}>
          {empty}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {items.map((i) => (
            <li key={i.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="mc-eyebrow" style={{ fontSize: 9.5 }}>
                  {i.head}
                </span>
                <span className="mc-num text-[10px]" style={{ color: "var(--dim)" }}>
                  {i.meta}
                </span>
              </div>
              <p className="mb-0 mt-1 text-[13px] leading-snug">{i.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: string;
}) {
  return (
    <div>
      <p className="mc-eyebrow mb-1" style={{ fontSize: 9 }}>
        {label}
      </p>
      <pre
        className={`m-0 max-h-[180px] overflow-auto whitespace-pre-wrap ${mono ? "font-mono text-[11px]" : "text-[12.5px]"}`}
        style={{ color: accent ?? "var(--haze)", fontFamily: mono ? undefined : "inherit" }}
      >
        {value}
      </pre>
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="mc-eyebrow" style={{ fontSize: 9 }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border px-2.5 py-1.5 font-mono text-[11px]"
        style={{ borderColor: "var(--line)", background: "rgba(11,19,35,.8)", color: "var(--ink)" }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v} style={{ background: "#0b1324" }}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
