import type { Asset } from "./types";

export type SearchGroup = "all" | Asset["asset_type"];

const ORDER: SearchGroup[] = ["all", "stock", "etf", "index", "fund", "market", "currency"];

export function searchGroups(results: Asset[], language: "zh" | "en"): Array<{ key: SearchGroup; label: string; count: number }> {
  const counts = new Map<SearchGroup, number>([["all", results.length]]);
  results.forEach((asset) => counts.set(asset.asset_type, (counts.get(asset.asset_type) || 0) + 1));
  return ORDER
    .filter((key) => key === "all" || (counts.get(key) || 0) > 0)
    .map((key) => ({ key, label: groupLabel(key, language), count: counts.get(key) || 0 }));
}

export function filterBySearchGroup(results: Asset[], group: SearchGroup): Asset[] {
  return group === "all" ? results : results.filter((asset) => asset.asset_type === group);
}

function groupLabel(group: SearchGroup, language: "zh" | "en"): string {
  if (language === "en") {
    return ({ all: "All", stock: "Stocks", etf: "ETFs", index: "Indexes", fund: "Funds", market: "Markets", currency: "FX" } as Record<SearchGroup, string>)[group];
  }
  return ({ all: "全部", stock: "股票", etf: "ETF", index: "指数", fund: "基金", market: "市场", currency: "外汇" } as Record<SearchGroup, string>)[group];
}
