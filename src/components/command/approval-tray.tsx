"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { copy, fmt } from "@/lib/copy";
import { decideApproval } from "@/lib/actions";
import type { AgentNode, PendingApproval } from "@/lib/data";

/**
 * §3 rule 6 made visible. Nothing gated leaves the building until the owner
 * taps here, so the tray carries the full draft, not a summary of it.
 */
export function ApprovalTray({
  approvals,
  blocked,
}: {
  approvals: PendingApproval[];
  blocked: AgentNode[];
}) {
  const [open, setOpen] = useState(false);
  const count = approvals.length + blocked.length;

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-full px-4 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.15em] transition-colors"
        style={{
          border: `1px solid ${count ? "rgba(245,196,81,.5)" : "var(--line)"}`,
          color: count ? "var(--gold)" : "var(--dim)",
          background: count ? "rgba(245,196,81,.07)" : "transparent",
        }}
      >
        {approvals.length > 0 && (
          <span
            className="inline-block h-[6px] w-[6px] rounded-full"
            style={{ background: "var(--gold)", boxShadow: "0 0 9px var(--gold)" }}
          />
        )}
        {copy.command.approvalTray}
        <span className="mc-num" style={{ opacity: 0.75 }}>
          {approvals.length}
        </span>
        {blocked.length > 0 && (
          <>
            <span style={{ opacity: 0.3 }}>·</span>
            <span style={{ color: "var(--crit)" }}>
              {copy.command.blockedTray} {blocked.length}
            </span>
          </>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="fixed right-6 top-[132px] z-40 max-h-[72vh] w-[min(520px,calc(100vw-3rem))] overflow-y-auto rounded p-5"
            style={{
              border: "1px solid var(--line-hi)",
              background: "linear-gradient(180deg, rgba(10,15,30,.98), rgba(12,24,26,.98))",
              boxShadow: "0 30px 60px rgba(0,0,0,.5)",
            }}
          >
            <p className="mc-eyebrow mb-4" style={{ color: "var(--gold)" }}>
              {copy.command.approvalTray}
            </p>
            {approvals.length === 0 ? (
              <p className="m-0 mb-6 text-[13px]" style={{ color: "var(--dim)" }}>
                {copy.command.noApprovals}
              </p>
            ) : (
              <div className="mb-7 flex flex-col gap-4">
                {approvals.map((a) => (
                  <ApprovalCard key={a.id} approval={a} />
                ))}
              </div>
            )}

            <p className="mc-eyebrow mb-3" style={{ color: "var(--crit)" }}>
              {copy.command.blockedTray}
            </p>
            {blocked.length === 0 ? (
              <p className="m-0 text-[13px]" style={{ color: "var(--dim)" }}>
                {copy.command.noBlocked}
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {blocked.map((b) => (
                  <li
                    key={b.id}
                    className="rounded px-3.5 py-3"
                    style={{ border: "1px solid rgba(255,77,109,.28)", background: "rgba(255,77,109,.05)" }}
                  >
                    <p className="mc-eyebrow mb-1.5" style={{ fontSize: 9.5 }}>
                      {b.displayName}
                    </p>
                    <p className="m-0 text-[12.5px] leading-snug">{b.blocker}</p>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function ApprovalCard({ approval }: { approval: PendingApproval }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);

  if (done) {
    return (
      <div className="rounded px-3.5 py-3" style={{ border: "1px solid var(--line)" }}>
        <p className="m-0 font-mono text-[11px]" style={{ color: "var(--haze)" }}>
          {approval.title} — {done}
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded"
      style={{ border: "1px solid rgba(245,196,81,.3)", background: "rgba(245,196,81,.04)" }}
    >
      <div className="px-4 pt-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="mc-eyebrow" style={{ fontSize: 9.5 }}>
            {approval.agentName} · {approval.gate}
          </p>
          <span className="mc-num text-[10px]" style={{ color: "var(--dim)" }}>
            {fmt.ago(approval.createdAt)}
          </span>
        </div>
        <h4 className="mb-0 mt-1.5 text-[14px] font-semibold leading-snug">{approval.title}</h4>
      </div>

      <pre
        className="mx-4 mt-3 max-h-[190px] overflow-y-auto whitespace-pre-wrap rounded px-3.5 py-3 font-mono text-[11.5px] leading-relaxed"
        style={{ background: "rgba(0,0,0,.28)", color: "var(--haze)", border: "1px solid var(--line)" }}
      >
        {approval.draft}
      </pre>

      <div className="flex flex-wrap gap-2 px-4 pb-3.5 pt-3">
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await decideApproval(approval.id, "approved");
              setDone("onaylandı");
            })
          }
          className="rounded px-3.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.13em] disabled:opacity-40"
          style={{ background: "var(--gold)", color: "var(--void)" }}
        >
          Onayla
        </button>
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await decideApproval(approval.id, "rejected", "Panelden reddedildi");
              setDone("reddedildi");
            })
          }
          className="rounded border px-3.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.13em] disabled:opacity-40"
          style={{ borderColor: "var(--line-hi)", color: "var(--haze)" }}
        >
          Reddet
        </button>
      </div>
    </div>
  );
}
