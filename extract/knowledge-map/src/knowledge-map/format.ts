/**
 * The three formatters the panel needs, pulled out of Mission Control's
 * project-wide `fmt` so this package carries no import into the host app.
 * Locale is a parameter rather than a constant.
 */

export function formatNumber(value: number, locale = "tr-TR"): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDate(value: Date | string | null | undefined, locale = "tr-TR"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

const UNITS: [limit: number, div: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [60_000, 1_000, "second"],
  [3_600_000, 60_000, "minute"],
  [86_400_000, 3_600_000, "hour"],
  [2_592_000_000, 86_400_000, "day"],
  [31_536_000_000, 2_592_000_000, "month"],
  [Infinity, 31_536_000_000, "year"],
];

export function formatAgo(value: Date | string | null | undefined, locale = "tr-TR"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  const delta = d.getTime() - Date.now();
  const abs = Math.abs(delta);
  const [, div, unit] = UNITS.find(([limit]) => abs < limit)!;
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(delta / div), unit);
}
