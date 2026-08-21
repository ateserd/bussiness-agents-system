"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { copy } from "@/lib/copy";
import type { AgentStatus } from "@/db/schema";
import { NODE } from "./layout";

/**
 * Node chrome for the org tree. Every visual state in §4.3 lives here:
 * idle dims to 40%, working glows, blocked breathes red, needs_approval keeps
 * a gold ring. Colour comes from the agent's department accent, never hardcoded.
 */

export type TreeNodeData = {
  label: string;
  role: string;
  accent: string;
  status: AgentStatus;
  paused: boolean;
  dimmed: boolean;
  selected: boolean;
  ticker?: string[];
  blocker?: string | null;
};

const DOT: Record<AgentStatus, string> = {
  idle: "var(--dim)",
  working: "var(--ok)",
  blocked: "var(--crit)",
  needs_approval: "var(--gold)",
};

function statusStyle(status: AgentStatus, accent: string): React.CSSProperties {
  if (status === "blocked") {
    return { animation: "mc-breathe-red 3.4s ease-in-out infinite" };
  }
  if (status === "needs_approval") {
    return { animation: "mc-ring-gold 2.6s ease-in-out infinite", borderColor: "rgba(245,196,81,.7)" };
  }
  if (status === "working") {
    return { borderColor: accent, boxShadow: `0 0 26px -6px ${accent}` };
  }
  return {};
}

function StatusPill({ status, paused }: { status: AgentStatus; paused: boolean }) {
  const label = paused ? copy.status.paused : copy.status[status];
  const color = paused ? "var(--dim)" : DOT[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap"
      style={{ color }}
    >
      <span
        className="inline-block h-[5px] w-[5px] rounded-full"
        style={{
          background: color,
          boxShadow: status === "idle" || paused ? "none" : `0 0 8px ${color}`,
          animation: status === "working" && !paused ? "mc-breathe 2.4s ease-in-out infinite" : undefined,
        }}
      />
      {label}
    </span>
  );
}

const hidden = { opacity: 0, pointerEvents: "none" as const };

function Ports() {
  return (
    <>
      <Handle type="target" position={Position.Top} style={hidden} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={hidden} isConnectable={false} />
    </>
  );
}

/* ---------------------------------------------------------------- owner --- */

export function OwnerNode({ data }: NodeProps) {
  const d = data as unknown as { label: string };
  return (
    <div className="flex flex-col items-center text-center" style={{ width: NODE.owner.w }}>
      <div
        className="grid h-[74px] w-[74px] place-items-center rounded-full font-mono text-[22px] font-semibold"
        style={{
          border: "1.5px solid var(--gold)",
          color: "var(--gold)",
          background:
            "radial-gradient(circle at 50% 42%, rgba(245,196,81,.24), rgba(245,196,81,.03) 68%)",
          boxShadow: "0 0 46px rgba(245,196,81,.26), inset 0 0 22px rgba(245,196,81,.14)",
        }}
      >
        ◆
      </div>
      <p
        className="mt-3.5 mb-0 font-mono text-[12.5px] font-medium"
        style={{ color: "var(--blank)", borderBottom: "1px dashed rgba(124,139,161,.55)", paddingBottom: 2 }}
      >
        {d.label}
      </p>
      <p className="mc-eyebrow mt-2" style={{ color: "var(--gold)", opacity: 0.82 }}>
        {copy.tier.owner}
      </p>
      <Ports />
    </div>
  );
}

/* ------------------------------------------------------------------ cos --- */

export function CosNode({ data }: NodeProps) {
  const d = data as unknown as TreeNodeData;
  return (
    <div
      className="flex flex-wrap items-center gap-x-7 gap-y-3 rounded px-6 py-4 transition-opacity"
      style={{
        width: NODE.cos.w,
        minHeight: NODE.cos.h,
        border: "1px solid rgba(245,196,81,.42)",
        background: "linear-gradient(180deg, rgba(245,196,81,.09), var(--panel) 62%)",
        boxShadow: "0 0 40px rgba(245,196,81,.12)",
        opacity: d.dimmed ? 0.32 : 1,
        ...statusStyle(d.status, "var(--gold)"),
      }}
    >
      <div className="min-w-0 flex-[1_1_180px]">
        <h3 className="m-0 text-[17px] font-bold tracking-[0.01em]">{d.label}</h3>
        <div className="mt-1.5 flex items-center gap-3">
          <StatusPill status={d.status} paused={d.paused} />
          <span className="mc-eyebrow" style={{ fontSize: 9.5 }}>
            {d.role}
          </span>
        </div>
      </div>
      <div
        className="min-w-0 flex-[1_1_230px] font-mono text-[11px] leading-[1.75]"
        style={{ borderLeft: "1px solid rgba(245,196,81,.24)", paddingLeft: 20, color: "var(--haze)" }}
      >
        {d.ticker?.map((line, i) => (
          <div key={i} className={line.startsWith("⚠") ? "" : ""} style={line.startsWith("⚠") ? { color: "var(--gold)" } : undefined}>
            {line}
          </div>
        ))}
      </div>
      <Ports />
    </div>
  );
}

/* ------------------------------------------------------------- director --- */

export function DirectorNode({ data }: NodeProps) {
  const d = data as unknown as TreeNodeData;
  return (
    <div
      className="rounded px-5 py-4 text-center transition-opacity"
      style={{
        width: NODE.director.w,
        minHeight: NODE.director.h,
        border: "1px solid var(--line)",
        borderTop: `2px solid ${d.accent}`,
        background: d.selected ? "var(--panel-hi)" : "var(--panel)",
        opacity: d.dimmed ? 0.28 : 1,
        ...statusStyle(d.status, d.accent),
      }}
    >
      <h3 className="m-0 text-[16px] font-bold tracking-[0.02em]">{d.label}</h3>
      <p className="mc-eyebrow mt-1.5" style={{ color: d.accent, fontSize: 10 }}>
        {d.role}
      </p>
      <div className="mt-2.5 flex justify-center">
        <StatusPill status={d.status} paused={d.paused} />
      </div>
      <Ports />
    </div>
  );
}

/* ----------------------------------------------------------------- lead --- */

export function LeadNode({ data }: NodeProps) {
  const d = data as unknown as TreeNodeData;
  return (
    <div
      className="rounded px-4 py-3 transition-opacity"
      style={{
        width: NODE.lead.w,
        minHeight: NODE.lead.h,
        border: "1px solid var(--line)",
        borderTop: `2px solid ${d.accent}`,
        background: d.selected ? "var(--panel-hi)" : "var(--panel)",
        opacity: d.dimmed ? 0.26 : 1,
        ...statusStyle(d.status, d.accent),
      }}
    >
      <p className="mc-eyebrow m-0" style={{ color: d.accent, fontSize: 9.5 }}>
        {d.role}
      </p>
      <h3 className="mt-1.5 mb-0 text-[14px] font-semibold leading-tight">{d.label}</h3>
      <div className="mt-2">
        <StatusPill status={d.status} paused={d.paused} />
      </div>
      <Ports />
    </div>
  );
}

/* --------------------------------------------------------------- worker --- */

export function WorkerNode({ data }: NodeProps) {
  const d = data as unknown as TreeNodeData;
  const dot = d.paused ? "var(--dim)" : DOT[d.status];
  return (
    <div
      className="flex items-center gap-2.5 rounded-sm px-3 py-2 transition-opacity"
      style={{
        width: NODE.worker.w,
        minHeight: NODE.worker.h,
        border: "1px solid var(--line)",
        borderLeft: `2px solid ${d.accent}`,
        background: d.selected ? "var(--panel-hi)" : "rgba(11,19,35,.5)",
        opacity: d.dimmed ? 0.22 : d.status === "idle" ? 0.62 : 1,
        ...(d.status === "blocked" ? statusStyle(d.status, d.accent) : {}),
        ...(d.status === "needs_approval" ? statusStyle(d.status, d.accent) : {}),
      }}
    >
      <span
        className="inline-block h-[6px] w-[6px] flex-none rounded-full"
        style={{
          background: dot,
          boxShadow: d.status === "idle" || d.paused ? "none" : `0 0 9px ${dot}`,
          animation:
            d.status === "working" && !d.paused ? "mc-breathe 2.4s ease-in-out infinite" : undefined,
        }}
      />
      <span className="truncate text-[12.5px] font-medium leading-tight">{d.label}</span>
      <Ports />
    </div>
  );
}

/* --------------------------------------------------------------- shared --- */

/** Shared services sit beside the Chief of Staff; they need a compact card. */
export function SharedNode({ data }: NodeProps) {
  const d = data as unknown as TreeNodeData;
  return (
    <div
      className="rounded px-3.5 py-2.5 transition-opacity"
      style={{
        width: NODE.shared.w,
        minHeight: NODE.shared.h,
        border: "1px solid var(--line)",
        borderTop: `2px solid ${d.accent}`,
        background: d.selected ? "var(--panel-hi)" : "var(--panel)",
        opacity: d.dimmed ? 0.3 : 1,
        ...statusStyle(d.status, d.accent),
      }}
    >
      <p className="mc-eyebrow m-0" style={{ color: d.accent, fontSize: 8.5 }}>
        {d.role}
      </p>
      <h3 className="mt-1 mb-0 text-[13px] font-semibold leading-tight">{d.label}</h3>
      <div className="mt-1.5">
        <StatusPill status={d.status} paused={d.paused} />
      </div>
      <Ports />
    </div>
  );
}

export const nodeTypes = {
  owner: OwnerNode,
  cos: CosNode,
  director: DirectorNode,
  lead: LeadNode,
  worker: WorkerNode,
  shared: SharedNode,
};
