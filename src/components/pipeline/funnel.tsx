import { Fragment } from "react";
import { copy } from "@/lib/copy";
import type { FunnelStage } from "@/lib/data";

/**
 * HAT — the one thing the system is for, drawn end to end.
 *
 * Leads, deals, projects and clients all existed as separate numbers on
 * separate screens; the line between them — which is the actual business —
 * was nowhere. Each stage shows its count and the first few rows, because the
 * number tells him the shape and the name tells him what to do about it.
 */

const LABEL: Record<FunnelStage["key"], string> = {
  lead: copy.pipeline.lead,
  deal: copy.pipeline.deal,
  project: copy.pipeline.project,
  client: copy.pipeline.client,
};

function BranchChip({ branch }: { branch: string }) {
  const flow = branch === "automation";
  const color = flow ? "var(--flow)" : "var(--accent)";
  return (
    <span
      className="chip flex-none"
      style={{ borderColor: flow ? "var(--flow-line)" : "var(--accent-line)", color, padding: "1px 7px", fontSize: 10.5 }}
    >
      {flow ? "flow" : "web"}
    </span>
  );
}

function Arrow() {
  return (
    <div className="flex flex-none items-center justify-center py-1 lg:py-0" aria-hidden>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--line-hi)" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" className="rotate-90 lg:rotate-0">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </div>
  );
}

export function Funnel({ stages }: { stages: FunnelStage[] }) {
  return (
    <div className="flex flex-col gap-5 px-4 pb-14 sm:px-8">
      <div className="flex flex-col items-stretch gap-2 lg:flex-row lg:gap-3">
        {stages.map((stage, i) => (
          <Fragment key={stage.key}>
            <div className="card min-w-0 flex-1 px-5 py-4">
              <p className="label">{LABEL[stage.key]}</p>
              <p className="mc-num m-0 mt-1.5 mb-0.5 text-[30px] font-medium leading-none">{stage.count}</p>
              <p className="m-0 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
                {stage.note}
              </p>
            </div>
            {i < stages.length - 1 && <Arrow />}
          </Fragment>
        ))}
      </div>

      <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stages.map((stage) => (
          <section key={stage.key} className="card">
            <div className="px-5 pt-4 pb-3">
              <p className="label">{LABEL[stage.key]}</p>
            </div>
            <hr className="rule" />
            {stage.rows.length === 0 ? (
              <p className="m-0 px-5 py-4 text-[13px]" style={{ color: "var(--ink-3)" }}>
                {copy.pipeline.empty}
              </p>
            ) : (
              <>
                {stage.rows.map((row, i) => (
                  <div
                    key={row.id}
                    className="px-5 py-3"
                    style={i > 0 ? { borderTop: "1px solid var(--line)" } : undefined}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="m-0 min-w-0 truncate text-[13.5px] font-medium">
                        {row.flagged && (
                          <span className="dot mr-2 inline-block align-middle" style={{ background: "var(--warn)" }} />
                        )}
                        {row.title}
                      </p>
                      <BranchChip branch={row.branch} />
                    </div>
                    <p className="mc-num m-0 mt-0.5 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                      {row.meta}
                    </p>
                  </div>
                ))}
                {stage.count > stage.rows.length && (
                  <p
                    className="m-0 px-5 py-3 text-[12px]"
                    style={{ borderTop: "1px solid var(--line)", color: "var(--ink-3)" }}
                  >
                    {copy.pipeline.more(stage.count - stage.rows.length)}
                  </p>
                )}
              </>
            )}
          </section>
        ))}
      </div>

      <p className="m-0 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
        {copy.pipeline.retention}
      </p>
    </div>
  );
}
