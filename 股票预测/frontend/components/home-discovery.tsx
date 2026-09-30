"use client";

import { useState } from "react";
import { ArrowRight, Check, Plus, RefreshCw } from "lucide-react";
import { assetPath } from "@/lib/asset-catalog";
import { displayAssetName } from "@/lib/assets";
import { assetTypeLabels, candidateMetric, discoveryCandidates, discoveryViews, periodValue, type DiscoveryView } from "@/lib/home-discovery";
import type { HomeData } from "@/lib/types";
import { AppLink as Link } from "./app-link";
import { AssetLogo } from "./asset-logo";
import { useApp } from "./providers";
import { useHomeResource } from "./use-home-resource";
import s from "./home.module.css";

export function HomeDiscovery() {
  const { language, favorites, toggleFavorite } = useApp();
  const zh = language === "zh";
  const resource = useHomeResource<HomeData>("/api/home");
  const [view, setView] = useState<DiscoveryView>("year");
  const [page, setPage] = useState(0);
  const rows = discoveryCandidates(resource.data, view);
  const pageCount = Math.max(1, Math.ceil(rows.length / 6));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * 6, safePage * 6 + 6);
  const selected = discoveryViews.find((item) => item.key === view)!;
  const dates = [...new Set(rows.map((row) => row.data_as_of).filter((date): date is string => Boolean(date)))].sort();
  const asOf = dates.length ? dates.length === 1 ? dates[0] : `${dates[0]} – ${dates[dates.length - 1]}` : null;
  const message = resource.status === "error" ? (zh ? "数据加载失败，请重试。" : "Unable to load data. Please retry.")
    : resource.status === "stale" ? (resource.failed ? (zh ? "正在显示过期缓存；刷新失败，可重试。" : "Showing stale cache; refresh failed. Retry below.") : (zh ? "正在显示过期缓存，后台刷新中…" : "Showing stale cache; refreshing…"))
      : resource.status === "loading" ? (zh ? "正在加载资产数据…" : "Loading asset data…")
        : resource.refreshing ? (zh ? "正在刷新，暂显示已有数据…" : "Refreshing; showing available data…")
          : !rows.length ? (zh ? "该视角暂无候选数据。" : "No candidates available for this view.")
            : (zh ? "已载入 · 按所示日期提供，非实时行情" : "Loaded · As-of data, not real-time quotes");
  return <section className={s.discovery} aria-labelledby="home-discovery-title">
    <header className={s.sectionHeader}><div><h2 id="home-discovery-title">{zh ? "资产发现" : "Discover assets"}</h2><p>{zh ? "从表现和波动出发，选择下一只研究对象。" : "Find your next research subject through returns and volatility."}</p></div><Link href="/stocks/">{zh ? "全部资产" : "All assets"}<ArrowRight size={14} /></Link></header>
    <div className={s.tabs} role="group" aria-label={zh ? "资产发现视角" : "Discovery perspective"}>{discoveryViews.map((item) => <button key={item.key} type="button" aria-pressed={view === item.key} onClick={() => { setView(item.key); setPage(0); }}>{zh ? item.zh : item.en}</button>)}</div>
    <div className={s.dataBar}>
      <p>{zh ? "数据范围：当前覆盖资产" : "Scope: currently covered assets"}{resource.data && <> · {rows.length}{zh ? " 只候选" : " candidates"}</>} · {zh ? "非全市场排名" : "Not a whole-market ranking"}<br />{zh ? "截至" : "As of"} {asOf || (zh ? "暂无日期" : "Date unavailable")}{view === "year" ? (zh ? " · 按 1Y 收益降序" : " · Descending 1Y return") : ""}</p>
      <button type="button" onClick={resource.refresh} disabled={resource.refreshing || resource.status === "loading"} aria-label={zh ? "刷新资产数据" : "Refresh asset data"}><RefreshCw size={14} className={resource.refreshing ? "spin" : ""} /><span>{zh ? "刷新" : "Refresh"}</span></button>
    </div>
    <p className={`${s.status} ${resource.status === "stale" || resource.status === "error" ? s.warning : ""}`} role="status" aria-live="polite">{message}</p>
    {resource.status === "loading" && !resource.data ? <div className={s.candidateGrid} aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div className={`${s.candidate} ${s.skeleton}`} key={i}><i /><i /><i /></div>)}</div>
      : !visible.length ? <div className={s.empty}><strong>{resource.status === "error" ? (zh ? "暂时无法获取候选" : "Candidates unavailable") : (zh ? "暂无候选" : "No candidates")}</strong><p>{zh ? "可以继续使用上方搜索，或切换数据视角。" : "Use the search above or choose another perspective."}</p>{resource.status === "error" && <button onClick={resource.refresh}>{zh ? "重新加载" : "Retry"}</button>}</div>
        : <div className={s.candidateGrid}>{visible.map((asset) => {
          const metric = candidateMetric(asset, view);
          const followed = favorites.some((item) => item.symbol === asset.symbol);
          return <article className={s.candidate} key={asset.symbol}>
            <div className={s.identity}><AssetLogo asset={asset} size="small" /><div><Link href={assetPath(asset.symbol)}><strong>{displayAssetName(asset, language) || asset.symbol}</strong></Link><small>{asset.symbol} {asset.exchange ? `· ${asset.exchange}` : ""}</small></div><span className={s.badges}>{assetTypeLabels(asset, language).map((tag) => <em key={tag}>{tag}</em>)}</span></div>
            <p className={s.reason}>{zh ? selected.reasonZh : selected.reasonEn}</p>
            <dl className={s.metrics}><div><dt>{metric.label} {view === "year" || view === "day" ? (zh ? "历史收益" : "Historical return") : (zh ? "预测研究值" : "Research forecast")}</dt><dd className={typeof metric.value === "number" && Number.isFinite(metric.value) ? metric.value > 0 ? "positive" : metric.value < 0 ? "negative" : "" : s.missing}>{periodValue(metric.value, zh, true)}</dd></div><div><dt>{zh ? "20日年化波动率" : "20-day annualized volatility"}</dt><dd className={asset.volatility_20d == null ? s.missing : ""}>{periodValue(asset.volatility_20d, zh)}</dd></div></dl>
            <div className={s.cardDate}>{zh ? "截至" : "As of"} {asset.data_as_of || (zh ? "暂无日期" : "Date unavailable")}</div>
            <footer className={s.cardActions}><Link href={assetPath(asset.symbol)} className={s.researchLink}>{zh ? "查看研究" : "View research"}<ArrowRight size={14} /></Link><button type="button" aria-pressed={followed} aria-label={`${followed ? (zh ? "取消关注" : "Unfollow") : (zh ? "关注" : "Follow")} ${asset.symbol}`} onClick={() => toggleFavorite(asset)}>{followed ? <Check size={14} /> : <Plus size={14} />}{followed ? (zh ? "已关注" : "Following") : (zh ? "关注" : "Follow")}</button></footer>
          </article>;
        })}</div>}
    <div className={s.discoveryFooter}><p>{zh ? "波动率仅反映价格波动，不是完整风险评级。预测研究值不代表未来收益。" : "Volatility measures price variation, not a complete risk rating. Forecasts are research values, not future returns."}</p>{pageCount > 1 && <nav aria-label={zh ? "候选分页" : "Candidate pages"}><button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>{zh ? "上一页" : "Previous"}</button><span>{safePage + 1} / {pageCount}</span><button disabled={safePage + 1 >= pageCount} onClick={() => setPage(safePage + 1)}>{zh ? "下一页" : "Next"}</button></nav>}</div>
  </section>;
}
