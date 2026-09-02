export type ResearchMarket = "global" | "us" | "a" | "hk";
export type ResearchGoal = "opportunity" | "risk" | "learn";

const CANDIDATES: Record<ResearchMarket, Record<ResearchGoal, string[]>> = {
  global: {
    opportunity: ["NVDA", "300750.SZ", "0700.HK"],
    risk: ["SPY", "GLD", "600519.SH"],
    learn: ["QQQ", "300750.SZ", "0700.HK"],
  },
  us: {
    opportunity: ["NVDA", "AMD", "MU"],
    risk: ["SPY", "QQQ", "GLD"],
    learn: ["QQQ", "NVDA", "GLD"],
  },
  a: {
    opportunity: ["300750.SZ", "002594.SZ", "300308.SZ"],
    risk: ["600519.SH", "601318.SH", "600036.SH"],
    learn: ["300750.SZ", "600519.SH", "601318.SH"],
  },
  hk: {
    opportunity: ["0700.HK", "9988.HK", "3690.HK"],
    risk: ["1299.HK", "0388.HK", "0700.HK"],
    learn: ["0700.HK", "1211.HK", "1299.HK"],
  },
};

export function researchCandidateSymbols(market: ResearchMarket, goal: ResearchGoal): string[] {
  return [...CANDIDATES[market][goal]];
}
