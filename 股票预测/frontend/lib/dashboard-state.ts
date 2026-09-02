import { assetPath } from "./asset-catalog";
import { MAX_ASSETS, parseSymbols, symbolsQuery } from "./selection";

export const DASHBOARD_RANGES = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "10Y", "MAX"] as const;
export const DETAIL_TABS = ["priceReturn", "research", "technical", "forecast", "performance", "predictionHistory"] as const;

export type DashboardRange = typeof DASHBOARD_RANGES[number];
export type DetailTab = typeof DETAIL_TABS[number];
export type DashboardViewState = {
  active: string;
  range: DashboardRange;
  normalized: boolean;
  isolated: string | null;
  tab: DetailTab;
};

type SearchParamsLike = { get: (key: string) => string | null };
type StorageLike = Pick<Storage, "getItem" | "setItem">;
type HistoryLike = Pick<History, "state" | "replaceState">;

export function parseDashboardViewState(params: SearchParamsLike, fallbackActive = ""): DashboardViewState {
  const rangeValue = params.get("range") || "1Y";
  const tabValue = params.get("tab") || "priceReturn";
  return {
    active: (params.get("active") || fallbackActive).toUpperCase(),
    range: DASHBOARD_RANGES.includes(rangeValue as DashboardRange) ? rangeValue as DashboardRange : "1Y",
    normalized: params.get("normalized") !== "0",
    isolated: params.get("solo")?.toUpperCase() || null,
    tab: DETAIL_TABS.includes(tabValue as DetailTab) ? tabValue as DetailTab : "priceReturn",
  };
}

export function dashboardDestination(symbols: string[], state: DashboardViewState): string {
  const clean = parseSymbols(symbols.join(","));
  if (!clean.length) return "/";
  const singlePath = clean.length === 1 ? assetPath(clean[0]) : "";
  const canonicalSingle = singlePath.startsWith("/stocks/");
  const path = canonicalSingle ? singlePath.split("?")[0] : "/analysis/";
  const params = new URLSearchParams();
  if (!canonicalSingle) params.set("symbols", symbolsQuery(clean));
  params.set("range", state.range);
  params.set("tab", state.tab);
  params.set("normalized", state.normalized ? "1" : "0");
  if (clean.length > 1 && state.active && clean.includes(state.active)) params.set("active", state.active);
  if (state.isolated && clean.includes(state.isolated)) params.set("solo", state.isolated);
  return `${path}?${params.toString()}`;
}

export function replaceDashboardLocation(history: HistoryLike, destination: string): void {
  history.replaceState(history.state, "", destination);
}

export function readStoredSymbols(storage: StorageLike, key: string): string[] {
  try {
    const value = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(value) ? parseSymbols(value.join(",")) : [];
  } catch {
    return [];
  }
}

export function rememberRecentSymbol(storage: StorageLike, symbol: string, maximum = 8): string[] {
  const normalized = parseSymbols(symbol)[0];
  if (!normalized) return readStoredSymbols(storage, "orivane-recent-symbols");
  const next = [normalized, ...readStoredSymbols(storage, "orivane-recent-symbols").filter((item) => item !== normalized)].slice(0, maximum);
  storage.setItem("orivane-recent-symbols", JSON.stringify(next));
  return next;
}

export function addComparisonDraft(storage: StorageLike, symbol: string, seed: string[] = []): string[] {
  const current = readStoredSymbols(storage, "orivane-compare-draft");
  const next = parseSymbols([...current, ...seed, symbol].join(",")).slice(0, MAX_ASSETS);
  storage.setItem("orivane-compare-draft", JSON.stringify(next));
  return next;
}

export function saveComparisonDraft(storage: StorageLike, symbols: string[]): string[] {
  const next = parseSymbols(symbols.join(","));
  storage.setItem("orivane-compare-draft", JSON.stringify(next));
  return next;
}
