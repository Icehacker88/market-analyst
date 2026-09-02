export function formatNumber(value: unknown, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : "—";
}

export function formatPercent(value: unknown, signed = false): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${signed && value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

export function formatMetricPercent(value: unknown, signed = false): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${signed && value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}
