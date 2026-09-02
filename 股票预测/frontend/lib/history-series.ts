import type { CompareSeries, History } from "./types";
import type { HistoryRecord } from "./types";

export const FULL_HISTORY_START = "1900-01-01";
export const LONG_HISTORY_RANGES = ["5Y", "10Y", "MAX"] as const;

export function isLongHistoryRange(range: string): boolean {
  return LONG_HISTORY_RANGES.includes(range as (typeof LONG_HISTORY_RANGES)[number]);
}

export function validatedPriceRecords(records: HistoryRecord[]): HistoryRecord[] {
  const hadNonPositivePrice = records.some((record) => Number.isFinite(record.Price) && record.Price <= 0);
  const priced = records.filter((record) => Number.isFinite(record.Price) && record.Price > 0);
  if (!hadNonPositivePrice) return priced;
  let stableStart = 0;
  for (let index = 1; index < priced.length; index += 1) {
    const ratio = priced[index].Price / priced[index - 1].Price;
    const gapDays = (Date.parse(`${priced[index].Date}T00:00:00Z`) - Date.parse(`${priced[index - 1].Date}T00:00:00Z`)) / 86400000;
    if (gapDays <= 10 && (ratio > 1.5 || ratio < 2 / 3)) stableStart = index;
  }
  return priced.slice(stableStart);
}

export function compareSeriesFromHistory(history: History): CompareSeries {
  const priced = validatedPriceRecords(history.records);
  const baseline = priced[0]?.Price || 1;
  return {
    symbol: history.symbol,
    data_as_of: history.data_as_of,
    data_source: history.data_source,
    snapshot: history.snapshot,
    points: priced.map((record) => ({
      date: record.Date,
      price: record.Price,
      normalized: baseline ? record.Price / baseline * 100 : 100,
    })),
  };
}

export function sliceCompareSeries(series: CompareSeries, start: string): CompareSeries {
  const points = series.points.filter((point) => point.date >= start);
  const baseline = points[0]?.price || 1;
  return {
    ...series,
    points: points.map((point) => ({
      ...point,
      normalized: baseline ? point.price / baseline * 100 : 100,
    })),
  };
}
