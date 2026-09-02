"use client";

import { useMemo } from "react";
import { comparisonColor, comparisonDasharray } from "@/lib/comparison-colors";
import { displayAssetName } from "@/lib/assets";
import type { Asset, CompareSeries } from "@/lib/types";
import { useApp } from "./providers";
import { EmptyState } from "./states";
import { UnifiedLineChart } from "./unified-line-chart";

export function ComparisonChart({ series, normalized, assets = [] }: { series: CompareSeries[]; normalized: boolean; assets?: Asset[] }) {
  const { language, t } = useApp();
  const data = useMemo(() => {
    const rows = new Map<string, Record<string, string | number>>();
    series.forEach((item) => item.points.forEach((point) => {
      const row = rows.get(point.date) || { date: point.date };
      row[item.symbol] = normalized ? point.normalized : point.price;
      rows.set(point.date, row);
    }));
    return Array.from(rows.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [normalized, series]);

  if (!data.length) return <EmptyState />;
  const labels = new Map(assets.map((asset) => [asset.symbol, displayAssetName(asset, language) || asset.symbol]));
  const styleIndex = (symbol: string, fallback: number) => {
    const index = assets.findIndex((asset) => asset.symbol === symbol);
    return index >= 0 ? index : fallback;
  };
  return (
    <div className="chart-area">
      <div className="comparison-key" aria-label={language === "zh" ? "走势线图例" : "Comparison line legend"}>
        {series.map((item, index) => { const colorIndex = styleIndex(item.symbol, index); return <span key={item.symbol}><i style={{ borderTopColor: comparisonColor(colorIndex), borderTopStyle: comparisonDasharray(colorIndex) ? "dashed" : "solid" }} /><strong>{labels.get(item.symbol) || item.symbol}</strong><small>{item.symbol}</small></span>; })}
      </div>
      <p className="sr-only">{language === "zh" ? `当前对比 ${series.map((item) => labels.get(item.symbol) || item.symbol).join("、")} 的${normalized ? "标准化" : "实际价格"}走势。` : `Comparing the ${normalized ? "normalized" : "actual price"} trend for ${series.map((item) => labels.get(item.symbol) || item.symbol).join(", ")}.`}</p>
      <UnifiedLineChart rows={data} xKey="date" series={series.map((item, index) => { const colorIndex = styleIndex(item.symbol, index); return { key: item.symbol, name: `${labels.get(item.symbol) || item.symbol} · ${item.symbol}`, color: comparisonColor(colorIndex), dashed: Boolean(comparisonDasharray(colorIndex)) }; })} />
      <div className="chart-caption">{normalized ? t("normalized") : t("actual")}</div>
    </div>
  );
}
