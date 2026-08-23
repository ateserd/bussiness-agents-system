import { copy, fmt } from "@/lib/copy";

/**
 * 12 weeks of collected cash, one band per branch. Stacked area rather than two
 * lines: the question this chart answers is "how much came in", and the split
 * between branches is the secondary read.
 */
export function TrendChart({
  data,
}: {
  data: { week: string; web: number; automation: number }[];
}) {
  const width = 1100;
  const height = 190;
  const padL = 8;
  const padB = 26;
  const padT = 12;

  const totals = data.map((d) => d.web + d.automation);
  const max = Math.max(...totals, 1);
  const stepX = (width - padL * 2) / Math.max(data.length - 1, 1);
  const scaleY = (v: number) => padT + (1 - v / max) * (height - padT - padB);

  const pointsFor = (pick: (d: (typeof data)[number]) => number) =>
    data.map((d, i) => [padL + i * stepX, scaleY(pick(d))] as const);

  const webPts = pointsFor((d) => d.web);
  const totalPts = pointsFor((d) => d.web + d.automation);

  const areaFrom = (pts: readonly (readonly [number, number])[]) =>
    `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")} L${pts[pts.length - 1][0].toFixed(1)},${height - padB} L${pts[0][0].toFixed(1)},${height - padB} Z`;
  const lineFrom = (pts: readonly (readonly [number, number])[]) =>
    `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")}`;

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: 720 }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={copy.ledger.trend}>
          <defs>
            <linearGradient id="ledger-total" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffb84d" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#ffb84d" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="ledger-web" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4dd6ff" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#4dd6ff" stopOpacity="0.03" />
            </linearGradient>
          </defs>

          {/* faint grid */}
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1={padL}
              y1={scaleY(max * f)}
              x2={width - padL}
              y2={scaleY(max * f)}
              stroke="var(--line)"
              strokeWidth="1"
            />
          ))}

          <path d={areaFrom(totalPts)} fill="url(#ledger-total)" />
          <path d={lineFrom(totalPts)} fill="none" stroke="#ffb84d" strokeWidth="1.5" strokeLinejoin="round" />
          <path d={areaFrom(webPts)} fill="url(#ledger-web)" />
          <path d={lineFrom(webPts)} fill="none" stroke="#4dd6ff" strokeWidth="1.5" strokeLinejoin="round" />

          {data.map((d, i) =>
            i % 2 === 0 ? (
              <text
                key={d.week}
                x={padL + i * stepX}
                y={height - 8}
                textAnchor="middle"
                fill="var(--ink-3)"
                fontSize="10"
                fontFamily="var(--mono)"
              >
                {d.week}
              </text>
            ) : null,
          )}

          <text x={padL} y={scaleY(max) - 4} fill="var(--ink-3)" fontSize="10" fontFamily="var(--mono)">
            {fmt.money(max)}
          </text>
        </svg>

        <div className="mt-3 flex gap-6">
          <Key color="#4dd6ff" label={copy.branch.webFull} />
          <Key color="#ffb84d" label={copy.branch.automationFull} />
        </div>
      </div>
    </div>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2 text-[12px]" style={{ color: "var(--ink-2)" }}>
      <span className="inline-block h-[3px] w-6 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
