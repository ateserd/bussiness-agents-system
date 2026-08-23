"use client";

import Link from "next/link";
import { useState } from "react";
import { copy, fmt } from "@/lib/copy";
import type { AgentNode, PendingApproval } from "@/lib/data";
import { ApprovalTray } from "./approval-tray";
import { NodeDrawer } from "./drawer";

/**
 * The COMMAND view.
 *
 * This replaced a 49-node org tree. The tree was the right picture of a
 * mirrored two-branch hierarchy; with four flat agents it drew four boxes and a
 * lot of empty canvas, so it carried less information than a list. The real
 * live board — what is running right now, what is parked on a question — comes
 * with the UI rework; this is the honest interim: who exists, what state they
 * are in, and what needs the owner.
 */

const STATUS_COLOR: Record<string, string> = {
  idle: "var(--dim)",
  working: "var(--sales)",
  blocked: "var(--crit)",
  needs_approval: "var(--gold)",
};

export function Deck({
  crew,
  ownerName,
  ticker,
  memoryCount,
  approvals,
}: {
  crew: AgentNode[];
  ownerName: string;
  ticker: string[];
  memoryCount: number;
  approvals: PendingApproval[];
}) {
  const [selected, setSelected] = useState<AgentNode | null>(null);
  const blocked = crew.filter((a) => a.status === "blocked");
  const manager = crew.find((a) => a.reportsTo === null) ?? null;
  const workers = crew.filter((a) => a.reportsTo !== null);

  return (
    <div className="flex flex-col gap-6 px-7 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="mc-eyebrow" style={{ fontSize: 9.5 }}>
          {ownerName} · {crew.length} ajan
        </p>
        <ApprovalTray approvals={approvals} blocked={blocked} />
      </div>

      {manager && (
        <button
          onClick={() => setSelected(manager)}
          className="flex flex-col gap-3 rounded p-5 text-left transition-colors"
          style={{
            border: "1px solid rgba(245,196,81,.32)",
            borderTop: "2px solid var(--gold)",
            background: "var(--panel)",
          }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="text-[17px] font-bold">{manager.displayName}</span>
            <span className="mc-eyebrow" style={{ fontSize: 9.5, color: STATUS_COLOR[manager.status] }}>
              {copy.status[manager.status]}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {ticker.map((line) => (
              <span key={line} className="mc-num text-[12px]" style={{ color: "var(--haze)" }}>
                {line}
              </span>
            ))}
          </div>
        </button>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {workers.map((agent) => (
          <button
            key={agent.id}
            onClick={() => setSelected(agent)}
            className="flex flex-col gap-2.5 rounded p-4 text-left transition-colors"
            style={{
              border: "1px solid var(--line)",
              borderTop: `2px solid ${agent.accent}`,
              background: "var(--panel)",
              opacity: agent.paused ? 0.55 : 1,
            }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[14px] font-semibold">{agent.displayName}</span>
              <span
                className="mc-eyebrow"
                style={{ fontSize: 9, color: agent.paused ? "var(--dim)" : STATUS_COLOR[agent.status] }}
              >
                {agent.paused ? copy.status.paused : copy.status[agent.status]}
              </span>
            </div>
            <p className="m-0 text-[12px] leading-relaxed" style={{ color: "var(--haze)" }}>
              {agent.mission.length > 130 ? `${agent.mission.slice(0, 130)}…` : agent.mission}
            </p>
            <span className="mc-eyebrow" style={{ fontSize: 9 }}>
              {agent.lastActivity ? fmt.ago(agent.lastActivity.startedAt) : copy.drawer.noRuns}
            </span>
          </button>
        ))}
      </div>

      <div className="flex justify-center pt-1">
        <Link
          href="/brain"
          className="group flex items-center gap-3.5 rounded px-5 py-3 transition-colors"
          style={{ border: "1px dashed rgba(142,163,189,.22)", background: "rgba(16,36,31,.4)" }}
        >
          <span
            className="inline-block h-[7px] w-[7px] flex-none rounded-full"
            style={{ background: "var(--ok)", boxShadow: "0 0 12px var(--ok)" }}
          />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.17em]" style={{ color: "var(--haze)" }}>
            {copy.command.sharedMemory} —{" "}
            <b style={{ color: "var(--ok)", fontWeight: 600 }}>
              {fmt.number(memoryCount)} {copy.command.memoriesSuffix}
            </b>
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.17em]" style={{ color: "var(--dim)" }}>
            {copy.command.openBrain}
          </span>
        </Link>
      </div>

      <NodeDrawer agent={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
