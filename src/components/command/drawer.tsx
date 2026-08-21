"use client";

import { useEffect, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { copy, fmt } from "@/lib/copy";
import { runAgentNow, toggleAgentPause } from "@/lib/actions";
import { Sparkline } from "@/components/deck/sparkline";
import type { AgentNode } from "@/lib/data";

type DrawerDetail = {
  log: { id: string; summary: string; outcome: string; costUsd: string; durationMs: number; startedAt: string; unsureAbout: string | null }[];
  memories: { id: string; content: string; kind: string; confidence: number }[];
};

export function NodeDrawer({
  agent,
  onClose,
}: {
  agent: AgentNode | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<DrawerDetail | null>(null);
  const [pending, startTransition] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!agent) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    fetch(`/api/agent/${encodeURIComponent(agent.id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail({ log: [], memories: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [agent]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <AnimatePresence>
      {agent && (
        <motion.aside
          key={agent.id}
          initial={{ x: "100%", opacity: 0.6 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0.4 }}
          transition={{ type: "spring", stiffness: 380, damping: 38 }}
          className="fixed right-0 top-0 z-40 flex h-full w-full max-w-[440px] flex-col overflow-y-auto"
          style={{
            background: "linear-gradient(180deg, rgba(10,15,30,.97), rgba(12,24,26,.97))",
            borderLeft: `1px solid var(--line)`,
            boxShadow: "-30px 0 60px rgba(0,0,0,.5)",
          }}
          aria-label={`${agent.displayName} ayrıntıları`}
        >
          {/* header */}
          <div className="sticky top-0 z-10 px-6 pt-6 pb-4" style={{ background: "rgba(10,15,30,.92)", borderBottom: "1px solid var(--line)", backdropFilter: "blur(8px)" }}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="mc-eyebrow" style={{ color: agent.accent }}>
                  {agent.branch === "shared"
                    ? copy.branch.sharedFull
                    : agent.branch === "web"
                      ? copy.branch.webFull
                      : copy.branch.automationFull}
                  {" · "}
                  {copy.department[agent.department as keyof typeof copy.department] ?? agent.department}
                </p>
                <h2 className="mt-2 mb-0 text-[21px] font-bold leading-tight">{agent.displayName}</h2>
                <p className="mt-1.5 mb-0 font-mono text-[10.5px]" style={{ color: "var(--dim)" }}>
                  {agent.id}
                </p>
              </div>
              <button
                onClick={onClose}
                className="flex-none rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]"
                style={{ borderColor: "var(--line)", color: "var(--haze)" }}
              >
                {copy.drawer.close}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-7 px-6 py-6">
            {agent.blocker && (
              <div
                className="rounded px-4 py-3 text-[13px] leading-relaxed"
                style={{ border: "1px solid rgba(255,77,109,.4)", background: "rgba(255,77,109,.07)", color: "var(--ink)" }}
              >
                <p className="mc-eyebrow mb-2" style={{ color: "var(--crit)" }}>
                  {copy.status.blocked}
                </p>
                {agent.blocker}
              </div>
            )}

            <Section title={copy.drawer.mission}>
              <p className="m-0 text-[13.5px] leading-relaxed" style={{ color: "var(--haze)" }}>
                {agent.mission}
              </p>
            </Section>

            {/* actions */}
            <div className="flex flex-wrap gap-2">
              <button
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await runAgentNow(agent.id);
                    setFlash(res.message);
                  })
                }
                className="rounded px-3.5 py-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.13em] disabled:opacity-40"
                style={{ background: agent.accent, color: "var(--void)" }}
              >
                {pending ? copy.common.loading : copy.drawer.runNow}
              </button>
              <button
                disabled={pending}
                onClick={() => startTransition(() => toggleAgentPause(agent.id).then(() => {}))}
                className="rounded border px-3.5 py-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.13em] disabled:opacity-40"
                style={{ borderColor: "var(--line-hi)", color: "var(--haze)" }}
              >
                {agent.paused ? copy.drawer.resume : copy.drawer.pause}
              </button>
              <button
                disabled
                title={copy.drawer.chatSoon}
                className="rounded border px-3.5 py-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.13em] opacity-35"
                style={{ borderColor: "var(--line)", color: "var(--dim)" }}
              >
                {copy.drawer.chat}
              </button>
            </div>
            {flash && (
              <p className="-mt-4 mb-0 font-mono text-[11px] leading-relaxed" style={{ color: "var(--gold)" }}>
                {flash}
              </p>
            )}

            {/* KPIs */}
            {agent.kpis.length > 0 && (
              <Section title={copy.drawer.kpis}>
                <div className="flex flex-col gap-4">
                  {agent.kpis.map((k) => (
                    <div key={k.name} className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="m-0 text-[13px] font-medium">{k.label}</p>
                        <p className="m-0 font-mono text-[10px]" style={{ color: "var(--dim)" }}>
                          {k.target != null && Number.isFinite(k.target)
                            ? `hedef ${k.target}`
                            : "hedef [[ N ]]"}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="mc-num text-[16px] font-semibold">{k.value}</span>
                        <Sparkline series={k.series} accent={agent.accent} target={k.target} />
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* config */}
            <Section title={copy.drawer.config}>
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-[12.5px]">
                <Row label={copy.drawer.reportsTo} value={agent.reportsTo ?? copy.common.none} mono />
                <Row label={copy.drawer.model} value={agent.model} mono />
                <Row label={copy.drawer.autonomy} value={copy.autonomy[agent.autonomy]} />
                <Row label={copy.drawer.schedule} value={agent.schedule ?? copy.common.none} mono />
                <Row label={copy.drawer.nextRun} value={fmt.date(agent.nextRunAt)} />
                <Row label={copy.drawer.lastRun} value={fmt.ago(agent.lastRunAt)} />
                <Row label={copy.drawer.tools} value={agent.tools.join(" · ")} mono />
                <Row label={copy.drawer.scopes} value={agent.memoryScopes.join(" · ")} mono />
                {agent.approvalRequiredFor.length > 0 && (
                  <Row label={copy.drawer.gates} value={agent.approvalRequiredFor.join(" · ")} mono accent="var(--gold)" />
                )}
              </dl>
              {agent.escalateWhen.length > 0 && (
                <div className="mt-4">
                  <p className="mc-eyebrow mb-2">{copy.drawer.escalate}</p>
                  <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                    {agent.escalateWhen.map((e, i) => (
                      <li key={i} className="text-[12.5px] leading-snug" style={{ color: "var(--haze)" }}>
                        — {e}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>

            {/* log */}
            <Section title={copy.drawer.log}>
              {!detail ? (
                <p className="m-0 font-mono text-[11px]" style={{ color: "var(--dim)" }}>
                  {copy.common.loading}
                </p>
              ) : detail.log.length === 0 ? (
                <p className="m-0 text-[13px]" style={{ color: "var(--dim)" }}>
                  {copy.drawer.noRuns}
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {detail.log.map((row) => (
                    <li key={row.id} className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="mc-eyebrow" style={{ fontSize: 9.5, color: outcomeColor(row.outcome) }}>
                          {copy.outcome[row.outcome as keyof typeof copy.outcome] ?? row.outcome}
                        </span>
                        <span className="mc-num text-[10px]" style={{ color: "var(--dim)" }}>
                          {fmt.ago(row.startedAt)} · {fmt.cost(Number(row.costUsd))} · {fmt.duration(row.durationMs)}
                        </span>
                      </div>
                      <p className="m-0 text-[12.5px] leading-snug">{row.summary}</p>
                      {row.unsureAbout && (
                        <p className="m-0 text-[11.5px] leading-snug" style={{ color: "var(--dim)" }}>
                          ? {row.unsureAbout}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* memories */}
            <Section title={copy.drawer.memories}>
              {!detail ? null : detail.memories.length === 0 ? (
                <p className="m-0 text-[13px]" style={{ color: "var(--dim)" }}>
                  {copy.drawer.noMemories}
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {detail.memories.map((m) => (
                    <li key={m.id} className="flex gap-2.5">
                      <span
                        className="mt-[7px] inline-block h-[5px] w-[5px] flex-none rounded-full"
                        style={{ background: agent.accent, opacity: 0.5 }}
                      />
                      <p className="m-0 text-[12.5px] leading-snug" style={{ color: "var(--haze)" }}>
                        {m.content}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function outcomeColor(outcome: string): string {
  if (outcome === "failure") return "var(--crit)";
  if (outcome === "blocked") return "var(--crit)";
  if (outcome === "needs_approval") return "var(--gold)";
  return "var(--ok)";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mc-eyebrow mb-3">{title}</h3>
      {children}
    </section>
  );
}

function Row({
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
    <>
      <dt className="mc-eyebrow" style={{ fontSize: 9.5, whiteSpace: "nowrap" }}>
        {label}
      </dt>
      <dd
        className={`m-0 break-words ${mono ? "font-mono text-[11px]" : "text-[12.5px]"}`}
        style={{ color: accent ?? "var(--haze)" }}
      >
        {value}
      </dd>
    </>
  );
}
