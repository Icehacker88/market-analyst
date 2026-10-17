import { describe, expect, it } from "vitest";
import { filterHomeSearchResults, searchHomeAssets } from "./home-search";
import { yearCandidateRank, type HomeCandidate } from "./home-discovery";

describe("homepage type-aware relevance", () => {
  it.each(["ETF", "etf", " ETFs "])("treats %s as a type and excludes Netflix", (query) => {
    const rows = searchHomeAssets(query);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((asset) => asset.asset_type === "etf")).toBe(true);
    expect(rows.some((asset) => asset.symbol === "NFLX")).toBe(false);
  });
  it("recognizes Chinese type words without degrading ticker or name search", () => {
    expect(searchHomeAssets("股票").every((row) => row.asset_type === "stock")).toBe(true);
    expect(searchHomeAssets("基金").every((row) => ["fund", "etf"].includes(row.asset_type))).toBe(true);
    for (const query of ["NVDA", "英伟达"]) expect(searchHomeAssets(query)[0].symbol).toBe("NVDA");
    for (const query of ["Netflix", "Netfl", "NFLX"]) expect(searchHomeAssets(query)[0].symbol).toBe("NFLX");
  });
  it("preserves mixed English name and type queries", () => {
    const rows = searchHomeAssets("Nasdaq 100 ETF");
    expect(rows.map((row) => row.symbol)).toContain("QQQM");
    expect(rows.every((row) => row.asset_type === "etf")).toBe(true);
  });
  it("filters accidental remote matches with the same type contract", () => {
    const netflix = searchHomeAssets("NFLX")[0];
    const qqq = searchHomeAssets("QQQ")[0];
    expect(filterHomeSearchResults([netflix, qqq], "ETF")).toEqual([qqq]);
    expect(filterHomeSearchResults([netflix], "Netflix")).toEqual([netflix]);
  });
});

describe("honest candidate-list rank", () => {
  const row = (symbol: string, value?: number): HomeCandidate => ({symbol, name: symbol, asset_type: "stock", data_source: "yahoo", return_1y: value});
  it("ranks valid unique candidates only, independent of pagination/order", () => {
    const rows = [row("A", 1), row("B", 3), row("C", 2), row("A", 1), row("missing"), row("invalid", NaN)];
    expect(yearCandidateRank(rows[2], rows)).toEqual({rank: 2, total: 3, tied: false});
    expect(yearCandidateRank(rows[4], rows)).toBeNull();
    expect(yearCandidateRank(rows[5], rows)).toBeNull();
  });
  it("reports tied ranks rather than pretending a unique market rank", () => {
    const rows = [row("A", 2), row("B", 2), row("C", 1)];
    expect(yearCandidateRank(rows[1], rows)).toEqual({rank: 1, total: 3, tied: true});
    expect(yearCandidateRank(rows[2], rows)).toEqual({rank: 3, total: 3, tied: false});
  });
});
