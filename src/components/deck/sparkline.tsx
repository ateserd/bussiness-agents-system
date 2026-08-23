/**
 * Small trend line for a KPI. Area fill plus an emphasised endpoint, because a
 * bare polyline reads as decoration; the endpoint is the number that matters.
 */
export function Sparkline({
  series,
  accent,
  width = 92,
  height = 26,
  target,
}: {
  series: number[];
  accent: string;
  width?: number;
  height?: number;
  target?: number | null;
}) {
  if (series.length < 2) {
    return <div style={{ width, height }} aria-hidden />;
  }

  const max = Math.max(...series, target ?? 0) || 1;
  const min = Math.min(...series, 0);
  const span = max - min || 1;
  const pad = 2;
  const stepX = (width - pad * 2) / (series.length - 1);

  const points = series.map((v, i) => {
    const x = pad + i * stepX;
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${points[points.length - 1][0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`;
  const [lastX, lastY] = points[points.length - 1];
  const gradientId = `spark-${accent.replace("#", "")}-${series.length}`;

  const targetY =
    target != null ? height - pad - ((target - min) / span) * (height - pad * 2) : null;

  return (
    <svg width={width} height={height} aria-hidden style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {targetY != null && (
        <line
          x1={pad}
          y1={targetY}
          x2={width - pad}
          y2={targetY}
          stroke="var(--ink-2)"
          strokeWidth="1"
          strokeDasharray="2 3"
          opacity="0.35"
        />
      )}
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={accent} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2.4" fill={accent} />
    </svg>
  );
}
