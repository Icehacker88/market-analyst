import { describe, expect, it } from "vitest";
import { addSymbol, parseSymbols, removeSymbol, startForRange, symbolsQuery } from "./selection";

describe("asset selection", () => {
  it("adds, removes and prevents a sixth asset", () => {
    expect(addSymbol(["SPY"], "QQQ").symbols).toEqual(["SPY", "QQQ"]);
    expect(removeSymbol(["SPY", "QQQ"], "SPY")).toEqual(["QQQ"]);
    expect(addSymbol(["SPY", "QQQ", "AAPL", "NVDA"], "MSFT")).toEqual({ symbols: ["SPY", "QQQ", "AAPL", "NVDA", "MSFT"], limited: false });
    expect(addSymbol(["SPY", "QQQ", "AAPL", "NVDA", "MSFT"], "GOOGL")).toEqual({ symbols: ["SPY", "QQQ", "AAPL", "NVDA", "MSFT"], limited: true });
  });

  it("restores unique symbols from the URL", () => {
    expect(parseSymbols("spy,QQQ,spy,AAPL,NVDA,MSFT,GOOGL")).toEqual(["SPY", "QQQ", "AAPL", "NVDA", "MSFT"]);
    expect(parseSymbols("YINGWEIDA,英伟达,NVDA")).toEqual(["NVDA"]);
    expect(addSymbol(["NVDA"], "英伟达")).toEqual({ symbols: ["NVDA"], limited: false });
    expect(symbolsQuery(["SPY", "QQQ"])).toBe("SPY,QQQ");
  });

  it("creates a valid range start date", () => {
    expect(startForRange("1M", new Date("2026-06-14T00:00:00Z"))).toBe("2026-05-14");
    expect(startForRange("YTD", new Date("2026-06-14T00:00:00Z"))).toBe("2026-01-01");
    expect(startForRange("MAX", new Date("2026-06-14T00:00:00Z"))).toBe("1900-01-01");
  });
});
