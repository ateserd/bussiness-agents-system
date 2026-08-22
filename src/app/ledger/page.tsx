import { TopBar } from "@/components/deck/top-bar";
import { getLedger } from "@/lib/data";
import { copy, fmt } from "@/lib/copy";
import { TrendChart } from "@/components/ledger/trend-chart";

export const dynamic = "force-dynamic";

const ACCENT: Record<string, string> = {
  web: "var(--sales)",
  automation: "var(--shared)",
  combined: "var(--gold)",
};

export default async function LedgerPage() {
  const { branches, weekly } = await getLedger();

  const combined = {
    revenueMtd: branches.reduce((n, b) => n + b.revenueMtd, 0),
    cashCollected: branches.reduce((n, b) => n + b.cashCollected, 0),
    pipelineValue: branches.reduce((n, b) => n + b.pipelineValue, 0),
    liveProjects: branches.reduce((n, b) => n + b.liveProjects, 0),
    unpaidInvoices: branches.reduce((n, b) => n + b.unpaidInvoices, 0),
    unpaidCount: branches.reduce((n, b) => n + b.unpaidCount, 0),
    agentCostMtd: branches.reduce((n, b) => n + b.agentCostMtd, 0),
    expensesMtd: branches.reduce((n, b) => n + b.expensesMtd, 0),
    netMtd: branches.reduce((n, b) => n + b.netMtd, 0),
  };

  const allUnavailable = [...new Set(branches.flatMap((b) => b.unavailable.map((u) => u.reason)))];

  return (
    <main className="relative z-10 min-h-screen pb-20">
      <TopBar caption={copy.ledger.subtitle} />

      <div className="px-7 pb-7">
        <h2 className="m-0 text-[26px] font-bold tracking-[-0.01em]">{copy.ledger.title}</h2>
      </div>

      {allUnavailable.length > 0 && (
        <div className="mx-7 mb-7 rounded px-4 py-3" style={{ border: "1px solid rgba(245,196,81,.3)", background: "rgba(245,196,81,.05)" }}>
          {allUnavailable.map((reason) => (
            <p key={reason} className="m-0 font-mono text-[11.5px]" style={{ color: "var(--gold)" }}>
              ⚠️ {copy.ledger.revenueMtd} {copy.ledger.unavailable} — {reason}
            </p>
          ))}
        </div>
      )}

      <div className="grid gap-5 px-7 lg:grid-cols-3">
        {branches.map((b) => (
          <Column
            key={b.branch}
            title={b.branch === "web" ? copy.branch.webFull : copy.branch.automationFull}
            eyebrow={b.branch === "web" ? "Şube A · web tasarım" : "Şube B · otomasyon"}
            accent={ACCENT[b.branch]}
            stats={b}
            unavailableFields={b.unavailable.map((u) => u.field)}
          />
        ))}
        <Column
          title={copy.ledger.combined}
          eyebrow="İki şube birlikte"
          accent={ACCENT.combined}
          stats={combined}
          unavailableFields={branches.flatMap((b) => b.unavailable.map((u) => u.field))}
        />
      </div>

      <section className="mt-9 px-7">
        <p className="mc-eyebrow mb-4">{copy.ledger.trend}</p>
        <TrendChart data={weekly} />
      </section>
    </main>
  );
}

type Stats = {
  revenueMtd: number;
  cashCollected: number;
  pipelineValue: number;
  liveProjects: number;
  unpaidInvoices: number;
  unpaidCount: number;
  agentCostMtd: number;
  expensesMtd: number;
  netMtd: number;
};

function Column({
  title,
  eyebrow,
  accent,
  stats,
  unavailableFields,
}: {
  title: string;
  eyebrow: string;
  accent: string;
  stats: Stats;
  unavailableFields: string[];
}) {
  const rows: { key: string; label: string; value: string; big?: boolean }[] = [
    { key: "revenueMtd", label: copy.ledger.revenueMtd, value: fmt.money(stats.revenueMtd), big: true },
    { key: "cashCollected", label: copy.ledger.cashCollected, value: fmt.money(stats.cashCollected) },
    { key: "pipelineValue", label: copy.ledger.pipelineValue, value: fmt.money(stats.pipelineValue) },
    { key: "liveProjects", label: copy.ledger.liveProjects, value: fmt.number(stats.liveProjects) },
    {
      key: "unpaidInvoices",
      label: copy.ledger.unpaidInvoices,
      value: `${fmt.money(stats.unpaidInvoices)} · ${stats.unpaidCount} adet`,
    },
    { key: "agentCostMtd", label: copy.ledger.agentCost, value: fmt.cost(stats.agentCostMtd) },
    { key: "expensesMtd", label: copy.ledger.expensesMtd, value: fmt.money(stats.expensesMtd) },
    { key: "netMtd", label: copy.ledger.netMtd, value: fmt.money(stats.netMtd) },
  ];

  return (
    <div
      className="rounded p-6"
      style={{ border: "1px solid var(--line)", borderTop: `2px solid ${accent}`, background: "var(--panel)" }}
    >
      <p className="mc-eyebrow" style={{ color: accent, fontSize: 9.5 }}>
        {eyebrow}
      </p>
      <h3 className="mb-6 mt-2 text-[17px] font-bold leading-tight">{title}</h3>

      <dl className="m-0 flex flex-col gap-4">
        {rows.map((r) => {
          const missing = unavailableFields.includes(r.key);
          return (
            <div key={r.key} className="flex items-baseline justify-between gap-4">
              <dt className="mc-eyebrow" style={{ fontSize: 9.5 }}>
                {r.label}
              </dt>
              <dd
                className={`mc-num m-0 text-right ${
                  missing ? "text-[12px]" : r.big ? "text-[24px] font-semibold" : "text-[15px]"
                }`}
                style={{ color: missing ? "var(--gold)" : r.big ? "var(--ink)" : "var(--haze)" }}
              >
                {/* A missing source is stated, not shouted — it should not
                    out-weigh the numbers that are real. */}
                {missing ? `⚠️ ${copy.ledger.unavailable}` : r.value}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
