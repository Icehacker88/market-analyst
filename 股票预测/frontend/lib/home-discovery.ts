import { formatPercent } from "./format";
import { localizeAssetType } from "./i18n";
import type { Asset, HomeData, ScreenerRow } from "./types";

// /api/home already returns these optional metrics; no extra candidate requests.
export type HomeCandidate = Asset & Partial<ScreenerRow>;
export type DiscoveryView = "year" | "day" | "bullish" | "bearish" | "volatility";
export const discoveryViews: { key: DiscoveryView; zh: string; en: string; reasonZh: string; reasonEn: string }[] = [
  { key: "year", zh: "近一年表现较强", en: "1Y leaders", reasonZh: "当前覆盖资产中，近一年涨幅较高", reasonEn: "Higher 1Y returns within current coverage" },
  { key: "day", zh: "今日强势", en: "Daily strength", reasonZh: "最新交易日涨幅较高", reasonEn: "Higher returns on the latest trading day" },
  { key: "bullish", zh: "1M 预测偏强", en: "Higher 1M forecasts", reasonZh: "1M 预测研究值相对较高", reasonEn: "Relatively higher 1M research forecasts" },
  { key: "bearish", zh: "1M 预测偏弱", en: "Lower 1M forecasts", reasonZh: "1M 预测研究值相对较低", reasonEn: "Relatively lower 1M research forecasts" },
  { key: "volatility", zh: "高波动观察", en: "Volatility watch", reasonZh: "20日年化波动率较高，需进一步核对风险", reasonEn: "Higher 20-day annualized volatility; review risk" },
];
export function discoveryCandidates(data: HomeData | null, view: DiscoveryView): HomeCandidate[] {
  if (!data) return [];
  switch (view) {
    case "year": return data.gainers || [];
    case "day": return data.overview?.gainers || [];
    // Never substitute another period, daily losers or a different selection criterion.
    case "bullish": return data.overview?.forecast_bullish || [];
    case "bearish": return data.overview?.forecast_bearish || [];
    case "volatility": return data.overview?.risk_watch || [];
  }
}
export function candidateMetric(asset: HomeCandidate, view: DiscoveryView) {
  return view === "year" ? { label: "1Y", value: asset.return_1y }
    : view === "day" ? { label: "1D", value: asset.return_1d }
      : { label: "1M", value: asset.forecast_1m_return };
}
export function periodValue(value: unknown, zh: boolean, signed = false): string {
  return typeof value === "number" && Number.isFinite(value) ? formatPercent(value, signed) : zh ? "暂无该周期数据" : "No data for this period";
}
export function assetTypeLabels(asset: Asset, language: "zh" | "en"): string[] {
  const labels = [localizeAssetType(asset.asset_type, language)];
  const name = [asset.name, asset.name_en, asset.name_zh].filter(Boolean).join(" ");
  // Only explicit product descriptions qualify, never price action or symbol guesses.
  if (asset.asset_type === "etf" || asset.asset_type === "fund") {
    if (/leverag|\b[2-9]x\b|[二三两234]倍|杠杆|\bProShares\s+Ultra(?:Pro)?(?:Short)?\b/i.test(name)) labels.push(language === "zh" ? "杠杆" : "Leveraged");
    if (/\binverse\b|\bProShares\s+(?:Ultra(?:Pro)?\s*)?Short\b|\bbear\s*(?:[1-9]x|[1-9]00%)|反向|做空/i.test(name)) labels.push(language === "zh" ? "反向" : "Inverse");
  }
  return labels;
}
