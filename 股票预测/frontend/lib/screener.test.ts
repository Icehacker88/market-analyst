import { describe, expect, it } from "vitest";
import { hasNumericField, sortScreenerRows } from "./screener";
import type { ScreenerRow } from "./types";

function row(symbol: string, values: Partial<ScreenerRow> = {}): ScreenerRow {
  return {
    symbol,
    name: symbol,
    asset_type: "stock",
    data_source: "yahoo",
    return_1y: null,
    sector: "Technology",
    latest_price: null,
    return_1d: null,
    return_3m: null,
    volatility_20d: null,
    market_cap: null,
    pe_ratio: null,
    signal: "Observe",
    confidence: null,
    ...values,
  };
}

describe("screener helpers", () => {
  it("keeps missing values at the end in either direction", () => {
    const rows = [row("MISSING"), row("LOW", { return_1y: -0.1 }), row("HIGH", { return_1y: 0.4 })];
    expect(sortScreenerRows(rows, "return_1y", "desc").map((item) => item.symbol)).toEqual(["HIGH", "LOW", "MISSING"]);
    expect(sortScreenerRows(rows, "return_1y", "asc").map((item) => item.symbol)).toEqual(["LOW", "HIGH", "MISSING"]);
  });

  it("only reports valuation support when numeric data exists", () => {
    expect(hasNumericField([row("A")], "pe_ratio")).toBe(false);
    expect(hasNumericField([row("A", { pe_ratio: 18.5 })], "pe_ratio")).toBe(true);
  });
});
