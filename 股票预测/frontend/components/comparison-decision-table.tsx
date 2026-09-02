"use client";

import { Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, type CSSProperties } from "react";
import { trackEvent } from "@/lib/analytics";
import { comparisonColor, comparisonDasharray } from "@/lib/comparison-colors";
import { displayAssetName } from "@/lib/assets";
import { forecastCredibility, predictionScore } from "@/lib/forecast-credibility";
import { formatMetricPercent, formatNumber, formatPercent } from "@/lib/format";
import type { Asset, Forecast, History } from "@/lib/types";
import { useApp } from "./providers";

export function ComparisonDecisionTable({
  items,
  activeSymbol,
  isolatedSymbol,
  onSelect,
  onToggleIsolation,
}: {
  items: Array<{ asset: Asset; history?: History; forecast?: Forecast }>;
  activeSymbol: string;
  isolatedSymbol: string | null;
  onSelect: (symbol: string) => void;
  onToggleIsolation: (symbol: string) => void;
}) {
  const { language } = useApp();
  const zh = language === "zh";
  const symbolsKey = items.map((item) => item.asset.symbol).join("|");
  useEffect(() => {
    if (items.length >= 2) trackEvent("comparison_view");
  }, [items.length, symbolsKey]);
  const takeaways = useMemo(() => {
    const rows = items.map((item, index) => {
      const confidence = item.forecast && item.history ? predictionScore(item.forecast, item.history, forecastCredibility(item.forecast, item.history)).score : item.forecast?.confidence_score;
      return {
        item,
        index,
        forecast1m: Number(item.forecast?.forecast_1m_return),
        confidence: Number(confidence),
        volatility: Number(item.history?.snapshot.annualized_volatility_20d),
        edge: Number(item.forecast?.validation?.backtest.direction_edge),
      };
    });
    const pick = (key: "forecast1m" | "confidence" | "volatility" | "edge", direction: "max" | "min") => rows.filter((row) => Number.isFinite(row[key])).sort((a, b) => direction === "max" ? b[key] - a[key] : a[key] - b[key])[0];
    return [
      { label: zh ? "1月预测最强" : "Strongest 1M forecast", row: pick("forecast1m", "max"), value: (value: number) => formatPercent(value, true), key: "forecast1m" as const },
      { label: zh ? "证据质量最高" : "Highest evidence score", row: pick("confidence", "max"), value: (value: number) => `${Math.round(value)}/100`, key: "confidence" as const },
      { label: zh ? "波动风险最低" : "Lowest volatility", row: pick("volatility", "min"), value: (value: number) => formatPercent(value), key: "volatility" as const },
      { label: zh ? "验证优势最好" : "Best validation edge", row: pick("edge", "max"), value: (value: number) => formatMetricPercent(value, true), key: "edge" as const },
    ].filter((entry) => entry.row);
  }, [items, zh]);
  if (items.length < 2) return null;
  return <section className="comparison-decision">
    <header><span><strong>{zh ? "对比决策摘要" : "Comparison decision summary"}</strong><small>{zh ? "周期预测、可信度、风险与失效条件并排查看" : "Forecasts, confidence, risk and invalidation side by side"}</small></span>{isolatedSymbol && <button onClick={() => onToggleIsolation(isolatedSymbol)}><Eye size={14} />{zh ? "显示全部曲线" : "Show all lines"}</button>}</header>
    <div className="comparison-takeaways">{takeaways.map((entry) => {
      const row = entry.row!;
      return <button key={entry.label} onClick={() => onSelect(row.item.asset.symbol)} style={{ "--series-color": comparisonColor(row.index) } as CSSProperties}><small>{entry.label}</small><strong>{displayAssetName(row.item.asset, language) || row.item.asset.symbol}</strong><span>{entry.value(row[entry.key])}</span></button>;
    })}</div>
    <div className="table-wrap"><table className="mobile-card-table"><thead><tr><th>{zh ? "资产" : "Asset"}</th><th>1D</th><th>5D</th><th>1M</th><th>{zh ? "可信度" : "Confidence"}</th><th>{zh ? "20日波动率" : "20D volatility"}</th><th>{zh ? "失效位" : "Invalidation"}</th><th>{zh ? "走步优势" : "Walk-forward edge"}</th><th>{zh ? "曲线" : "Line"}</th></tr></thead><tbody>{items.map((item, index) => {
      const confidence = item.forecast && item.history ? predictionScore(item.forecast, item.history, forecastCredibility(item.forecast, item.history)).score : item.forecast?.confidence_score;
      const isolated = isolatedSymbol === item.asset.symbol;
      return <tr key={item.asset.symbol} className={activeSymbol === item.asset.symbol ? "active" : ""} style={{ "--series-color": comparisonColor(index) } as CSSProperties}>
        <td data-label={zh ? "资产" : "Asset"}><button className="comparison-asset" onClick={() => onSelect(item.asset.symbol)}><i style={{ borderColor: comparisonColor(index), borderStyle: comparisonDasharray(index) ? "dashed" : "solid" }} /><span><strong>{displayAssetName(item.asset, language) || item.asset.symbol}</strong><small>{item.asset.symbol}</small></span></button></td>
        <td data-label="1D" className={Number(item.forecast?.forecast_1d_return) >= 0 ? "positive" : "negative"}>{formatPercent(item.forecast?.forecast_1d_return, true)}</td>
        <td data-label="5D" className={Number(item.forecast?.forecast_5d_return) >= 0 ? "positive" : "negative"}>{formatPercent(item.forecast?.forecast_5d_return, true)}</td>
        <td data-label="1M" className={Number(item.forecast?.forecast_1m_return) >= 0 ? "positive" : "negative"}>{formatPercent(item.forecast?.forecast_1m_return, true)}</td>
        <td data-label={zh ? "可信度" : "Confidence"}>{typeof confidence === "number" ? `${Math.round(confidence)}/100` : "—"}</td>
        <td data-label={zh ? "20日波动率" : "20D volatility"}>{formatPercent(item.history?.snapshot.annualized_volatility_20d)}</td>
        <td data-label={zh ? "失效位" : "Invalidation"}>{formatNumber(item.forecast?.key_levels?.invalidation)}</td>
        <td data-label={zh ? "走步优势" : "Walk-forward edge"}>{formatMetricPercent(item.forecast?.validation?.backtest.direction_edge, true)}</td>
        <td data-label={zh ? "曲线" : "Line"}><button className={isolated ? "line-toggle active" : "line-toggle"} onClick={() => onToggleIsolation(item.asset.symbol)} aria-label={isolated ? (zh ? `恢复全部曲线` : "Show all lines") : (zh ? `只看 ${displayAssetName(item.asset, language) || item.asset.symbol}` : `Show only ${displayAssetName(item.asset, language) || item.asset.symbol}`)}>{isolated ? <EyeOff size={14} /> : <Eye size={14} />}{isolated ? (zh ? "单独显示" : "Solo") : (zh ? "只看" : "Only")}</button></td>
      </tr>;
    })}</tbody></table></div>
  </section>;
}
