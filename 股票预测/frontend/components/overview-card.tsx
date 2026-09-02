"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import type { CSSProperties } from "react";
import type { Asset, Forecast, History } from "@/lib/types";
import { displayAssetName } from "@/lib/assets";
import { formatNumber, formatPercent } from "@/lib/format";
import { localizeSignal, localizeSource } from "@/lib/i18n";
import { useApp } from "./providers";
import { AssetLogo } from "./asset-logo";
import { Skeleton } from "./states";

export function OverviewCard({ asset, history, forecast, forecastLoading = false, loading, seriesColor, onSelect }: { asset: Asset; history?: History; forecast?: Forecast; forecastLoading?: boolean; loading: boolean; seriesColor?: string; onSelect?: () => void }) {
  const { isFavorite, language, t, toggleFavorite } = useApp();
  const snapshot = history?.snapshot || {};
  const favorite = isFavorite(asset.symbol);
  return (
    <article className={`overview-card ${seriesColor ? "series-linked" : ""}`} style={seriesColor ? ({ "--series-color": seriesColor } as CSSProperties) : undefined}>
      <header>
        {onSelect ? <button className="asset-title-button" onClick={onSelect}>{seriesColor && <i className="series-marker" />}<AssetLogo asset={asset} /><span><strong>{displayAssetName(asset, language) || asset.symbol}</strong><small>{asset.symbol}</small></span></button> : <span>{seriesColor && <i className="series-marker" />}<AssetLogo asset={asset} /><span><strong>{displayAssetName(asset, language) || asset.symbol}</strong><small>{asset.symbol}</small></span></span>}
        <button onClick={(event) => { event.stopPropagation(); toggleFavorite(asset); }} aria-label={favorite ? t("removeFavorite") : t("addFavorite")}>
          {favorite ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
        </button>
      </header>
      {loading ? <Skeleton rows={3} /> : <>
        <div className="price-line"><b>{formatNumber(snapshot.latest_price as number)}</b><em className={tone(snapshot.return_1d as number)}>{formatPercent(snapshot.return_1d as number, true)}</em></div>
        <div className="metric-line"><span>{t("return5d")}<strong className={tone(snapshot.return_5d as number)}>{formatPercent(snapshot.return_5d as number, true)}</strong></span><span>{t("volatility20d")}<strong>{formatPercent(snapshot.annualized_volatility_20d as number)}</strong></span></div>
        <footer><span>{forecast ? localizeSignal(forecast.signal, language) : forecastLoading ? (language === "zh" ? "预测生成中" : "Forecasting") : "—"}</span><small>{history?.data_as_of || "—"} · {localizeSource(history?.data_source || asset.data_source, language)}</small></footer>
      </>}
    </article>
  );
}

function tone(value?: number) {
  return typeof value === "number" && value > 0
    ? "positive"
    : typeof value === "number" && value < 0
      ? "negative"
      : "";
}
