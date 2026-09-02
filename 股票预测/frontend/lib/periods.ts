import type { HistoryRecord } from "./types";
import type { MessageKey } from "./i18n";
import { validatedPriceRecords } from "./history-series";

export const RANGE_OPTIONS: { range: string; label: MessageKey }[] = [
  { range: "1D", label: "period1d" },
  { range: "5D", label: "period5d" },
  { range: "1M", label: "period1m" },
  { range: "6M", label: "period6m" },
  { range: "YTD", label: "periodYtd" },
  { range: "1Y", label: "period1y" },
  { range: "5Y", label: "period5y" },
  { range: "10Y", label: "period10y" },
  { range: "MAX", label: "periodAll" },
];

export function periodReturn(records: HistoryRecord[], range: string, now = new Date()): number | null {
  const priced = validatedPriceRecords(records);
  if (priced.length < 2) return null;
  const latest = priced.at(-1)!;
  let baseline: HistoryRecord | undefined;

  if (range === "1D") baseline = priced.at(-2);
  else if (range === "5D") baseline = priced.at(-6) || priced[0];
  else if (range === "MAX") baseline = priced[0];
  else {
    const threshold = rangeStart(range, now);
    baseline = priced.find((record) => record.Date >= threshold) || priced[0];
  }

  return baseline?.Price ? latest.Price / baseline.Price - 1 : null;
}

function rangeStart(range: string, now: Date): string {
  const start = new Date(now);
  if (range === "YTD") start.setMonth(0, 1);
  else {
    const days: Record<string, number> = { "1M": 31, "6M": 186, "1Y": 366, "5Y": 1827, "10Y": 3653 };
    start.setDate(start.getDate() - (days[range] || 366));
  }
  return start.toISOString().slice(0, 10);
}
