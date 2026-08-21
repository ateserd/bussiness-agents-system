"use client";

import { useState } from "react";
import Link from "next/link";
import { copy, fmt } from "@/lib/copy";
import type { AgentNode, PendingApproval } from "@/lib/data";
import { OrgTree, type BranchFilter } from "./org-tree";
import { ApprovalTray } from "./approval-tray";

const FILTERS: { key: BranchFilter; label: string }[] = [
  { key: "all", label: copy.branch.all },
  { key: "web", label: copy.branch.web },
  { key: "automation", label: copy.branch.automation },
];

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
  const [filter, setFilter] = useState<BranchFilter>("all");
  const blocked = crew.filter((a) => a.status === "blocked");

  return (
    <div className="relative flex min-h-[calc(100vh-96px)] flex-col">
      {/* branch switcher + tray badge */}
      <div className="relative z-20 flex flex-wrap items-center justify-between gap-4 px-7 pb-4">
        <div
          className="flex gap-1 rounded-full p-1"
          style={{ border: "1px solid var(--line)", background: "rgba(11,19,35,.5)" }}
          role="tablist"
          aria-label="Şube"
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.key)}
                className="rounded-full px-4 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors"
                style={{
                  color: active ? "var(--ink)" : "var(--dim)",
                  background: active ? "rgba(142,163,189,.13)" : "transparent",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-4">
          <ApprovalTray approvals={approvals} blocked={blocked} />
          <p className="mc-eyebrow hidden lg:block" style={{ fontSize: 9.5 }}>
            {copy.command.hint}
          </p>
        </div>
      </div>

      {/* the tree */}
      {/* xyflow's root is height:100%, so this wrapper needs a *definite* height
          — not flex-grown — or the percentage resolves to zero and the tree
          renders into nothing. */}
      <div className="relative w-full shrink-0" style={{ height: "68vh", minHeight: 520 }}>
        <OrgTree crew={crew} ownerName={ownerName} ticker={ticker} filter={filter} />
      </div>

      {/* shared memory strip */}
      <div className="relative z-20 flex justify-center px-7 pb-6 pt-3">
        <Link
          href="/brain"
          className="group flex items-center gap-3.5 rounded px-5 py-3 transition-colors"
          style={{
            border: "1px dashed rgba(142,163,189,.22)",
            background: "rgba(16,36,31,.4)",
          }}
        >
          <span
            className="inline-block h-[7px] w-[7px] flex-none rounded-full"
            style={{
              background: "var(--ok)",
              boxShadow: "0 0 12px var(--ok)",
              animation: "mc-breathe 2.8s ease-in-out infinite",
            }}
          />
          <span
            className="font-mono text-[10.5px] uppercase tracking-[0.17em]"
            style={{ color: "var(--haze)" }}
          >
            {copy.command.sharedMemory} —{" "}
            <b style={{ color: "var(--ok)", fontWeight: 600 }}>
              {fmt.number(memoryCount)} {copy.command.memoriesSuffix}
            </b>
          </span>
          <span
            className="font-mono text-[10.5px] uppercase tracking-[0.17em] transition-colors group-hover:opacity-100"
            style={{ color: "var(--dim)" }}
          >
            {copy.command.openBrain}
          </span>
        </Link>
      </div>
    </div>
  );
}
