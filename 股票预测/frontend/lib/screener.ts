import type { ScreenerRow } from "./types";

export type ScreenerSortKey = "return_1y" | "return_3m" | "return_1d" | "volatility_20d" | "latest_price";
export type ScreenerSortDirection = "asc" | "desc";

export function hasNumericField(rows: ScreenerRow[], field: "pe_ratio" | "market_cap"): boolean {
  return rows.some((row) => typeof row[field] === "number" && Number.isFinite(row[field]));
}

export function sortScreenerRows(
  rows: ScreenerRow[],
  key: ScreenerSortKey,
  direction: ScreenerSortDirection,
): ScreenerRow[] {
  return [...rows].sort((left, right) => {
    const leftValue = numericValue(left[key]);
    const rightValue = numericValue(right[key]);
    if (leftValue === null && rightValue === null) return left.symbol.localeCompare(right.symbol);
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return direction === "desc" ? rightValue - leftValue : leftValue - rightValue;
  });
}

function numericValue(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
