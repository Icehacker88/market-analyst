import { describe, expect, it } from "vitest";
import { matchesScreenerMarket, parseScreenerQuery } from "./screener-query";

describe("parseScreenerQuery", () => {
  it("parses a Chinese semiconductor screen", () => {
    expect(parseScreenerQuery("美股半导体，看涨，一年涨幅超过 50%，波动率低于 40%"))
      .toMatchObject({ market: "us", sector: "Technology", signal: "Up", theme: "semiconductor", minReturn: "50", maxVolatility: "40" });
  });

  it("parses A-share valuation conditions", () => {
    expect(parseScreenerQuery("A股低波动，市盈率低于30，从高到低"))
      .toMatchObject({ market: "a", maxPe: "30", maxVolatility: "30", sortDirection: "desc" });
  });
});

describe("matchesScreenerMarket", () => {
  it("separates A, HK and US symbols", () => {
    expect(matchesScreenerMarket("300750.SZ", "a")).toBe(true);
    expect(matchesScreenerMarket("0700.HK", "hk")).toBe(true);
    expect(matchesScreenerMarket("NVDA", "us")).toBe(true);
  });
});
