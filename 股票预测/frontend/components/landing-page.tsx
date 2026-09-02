"use client";

import { ArrowRight, Bell, BookOpen, ExternalLink, ListFilter, Plus, RefreshCw, Search, Sparkles, TrendingUp } from "lucide-react";
import dynamic from "next/dynamic";
import { AppLink as Link } from "./app-link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { getForecastScoreboard, getHomeData, resolveAssets } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import { assetPath, catalogAssetBySymbol } from "@/lib/asset-catalog";
import { displayAssetName } from "@/lib/assets";
import { addComparisonDraft, dashboardDestination } from "@/lib/dashboard-state";
import { formatMetricPercent, formatPercent } from "@/lib/format";
import { forecastTrend } from "@/lib/forecast-trend";
import { localizeAssetType, localizeSource } from "@/lib/i18n";
import { researchCandidateSymbols, type ResearchGoal, type ResearchMarket } from "@/lib/research-preferences";
import { filterBySearchGroup, searchGroups, type SearchGroup } from "@/lib/search-groups";
import type { Asset, Gainer, HomeData, MarketOverview } from "@/lib/types";
import { AssetLogo } from "./asset-logo";
import { useApp } from "./providers";
import { SearchField } from "./search-field";
import { Skeleton } from "./states";
import { useAssetSearch } from "./use-asset-search";

const WatchlistChangeSummary = dynamic(() => import("./watchlist-change-summary").then((module) => module.WatchlistChangeSummary), { ssr: false });
const DailyResearchBrief = dynamic(() => import("./daily-research-brief").then((module) => module.DailyResearchBrief), { ssr: false });
const ResearchHabitCard = dynamic(() => import("./research-habit-card").then((module) => module.ResearchHabitCard), { ssr: false });

const FALLBACK_POPULAR: Gainer[] = [
  { symbol: "NVDA", name: "NVIDIA Corporation", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo", return_1y: null },
  { symbol: "PLTR", name: "Palantir Technologies Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo", return_1y: null },
  { symbol: "AVGO", name: "Broadcom Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo", return_1y: null },
  { symbol: "TSM", name: "Taiwan Semiconductor Manufacturing Company Limited", asset_type: "stock", exchange: "NYSE", currency: "USD", data_source: "yahoo", return_1y: null },
  { symbol: "SMH", name: "VanEck Semiconductor ETF", asset_type: "etf", exchange: "NASDAQ", currency: "USD", data_source: "yahoo", return_1y: null },
  { symbol: "QQQ", name: "Invesco QQQ Trust", asset_type: "etf", exchange: "NASDAQ", currency: "USD", data_source: "yahoo", return_1y: null },
];

export function LandingPage() {
  const { favorites, language, t, toggleFavorite, updateUserState, userState } = useApp();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [openResults, setOpenResults] = useState(false);
  const [group, setGroup] = useState<SearchGroup>("all");
  const [activeResult, setActiveResult] = useState(0);
  const [gainers, setGainers] = useState<Gainer[]>(FALLBACK_POPULAR);
  const [gainerPage, setGainerPage] = useState(0);
  const [gainersLoading, setGainersLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [scoreboard, setScoreboard] = useState<HomeData["scoreboard"] | null>(null);
  const [recents, setRecents] = useState<Asset[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);
  const { results, remoteLoading, remoteComplete, error: searchError } = useAssetSearch(query);

  useEffect(() => {
    function closeOnOutsideClick(event: PointerEvent) {
      if (!searchRef.current?.contains(event.target as Node)) setOpenResults(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  useEffect(() => {
    getHomeData()
      .then((data) => {
        setOverview(data.overview);
        setGainers(data.gainers.length ? data.gainers : FALLBACK_POPULAR);
      })
      .catch(() => {
        setOverview(null);
        setGainers((current) => current.length ? current : FALLBACK_POPULAR);
      })
      .finally(() => setGainersLoading(false));
    try {
      const symbols = JSON.parse(localStorage.getItem("orivane-recent-symbols") || "[]") as string[];
      if (symbols.length) resolveAssets(symbols.slice(0, 4)).then(setRecents).catch(() => undefined);
    } catch { setRecents([]); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      getForecastScoreboard().then(setScoreboard).catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  function open(asset: Asset) {
    router.push(assetPath(asset.symbol));
  }

  function compare(asset: Asset) {
    const seed = recents[0] && recents[0].symbol !== asset.symbol ? [recents[0].symbol] : [];
    const symbols = addComparisonDraft(localStorage, asset.symbol, seed);
    router.push(dashboardDestination(symbols, { active: asset.symbol, range: "1Y", normalized: true, isolated: null, tab: "priceReturn" }));
  }

  function alert(asset: Asset) {
    router.push(`/favorites/?alert=${encodeURIComponent(asset.symbol)}`);
  }

  function refreshPopular() {
    const pageCount = Math.max(1, Math.ceil(gainers.length / 6));
    setRefreshing(true);
    setGainerPage((current) => (current + 1) % pageCount);
    window.setTimeout(() => setRefreshing(false), 450);
  }

  const ranked = gainers.length ? gainers : FALLBACK_POPULAR;
  const visibleGainers = ranked.slice(gainerPage * 6, gainerPage * 6 + 6);
  const researchMarket = userState.research_preferences?.market || "global";
  const researchGoal = userState.research_preferences?.goal || "opportunity";
  const personalizedCandidates = researchCandidateSymbols(researchMarket, researchGoal)
    .map(catalogAssetBySymbol)
    .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
  const onboardingCandidates = [...new Map([...personalizedCandidates, ...ranked].map((asset) => [asset.symbol, asset])).values()]
    .filter((asset) => !favorites.some((favorite) => favorite.symbol === asset.symbol))
    .slice(0, 3);
  const visibleResults = filterBySearchGroup(results, group);
  const shownResults = visibleResults.slice(0, 20);
  const groups = searchGroups(results, language);
  useEffect(() => { setActiveResult(0); }, [group, query]);

  function searchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { setOpenResults(false); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpenResults(true);
      setActiveResult((current) => shownResults.length ? (current + (event.key === "ArrowDown" ? 1 : -1) + shownResults.length) % shownResults.length : 0);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const asset = shownResults[activeResult];
      if (asset) { setOpenResults(false); open(asset); }
    }
  }
  const overviewGroups = overview ? [
    { title: language === "zh" ? "今日强势" : "Today’s strength", items: overview.gainers, value: (asset: MarketOverview["gainers"][number]) => formatPercent(asset.return_1d, true), tone: (asset: MarketOverview["gainers"][number]) => Number(asset.return_1d ?? 0) >= 0 ? "positive" : "negative" },
    { title: language === "zh" ? "1月预测研究值偏强" : "Higher 1M research forecasts", items: overview.forecast_bullish || overview.forecast_movers, value: (asset: MarketOverview["gainers"][number]) => formatPercent(asset.forecast_1m_return ?? asset.forecast_1d_return, true), tone: (asset: MarketOverview["gainers"][number]) => Number(asset.forecast_1m_return ?? asset.forecast_1d_return ?? 0) >= 0 ? "positive" : "negative" },
    { title: language === "zh" ? "1月预测研究值偏弱" : "Lower 1M research forecasts", items: overview.forecast_bearish || overview.losers, value: (asset: MarketOverview["gainers"][number]) => formatPercent(asset.forecast_1m_return ?? asset.return_1d, true), tone: (asset: MarketOverview["gainers"][number]) => Number(asset.forecast_1m_return ?? asset.return_1d ?? 0) >= 0 ? "positive" : "negative" },
    { title: language === "zh" ? "高波动风险" : "High-volatility risk", items: overview.risk_watch || overview.forecast_movers, value: (asset: MarketOverview["gainers"][number]) => formatPercent(asset.volatility_20d), tone: () => "negative" },
  ] : [];
  const backtestAll = scoreboard?.backtest.statistics.find((item) => item.window === "All");
  const liveAll = scoreboard?.live.statistics.find((item) => item.window === "All");
  const liveTrend = scoreboard ? forecastTrend(scoreboard.live.statistics) : null;
  const horizonStats = scoreboard?.backtest.horizon_statistics.filter((item) => item.window === "All") || [];
  const validationReady = Number(backtestAll?.direction_edge) > 0 && Number(liveAll?.completed) >= 20 && Number(liveAll?.direction_edge) > 0;
  const returningAssets = [...new Map([...recents, ...favorites].map((asset) => [asset.symbol, asset])).values()].slice(0, 6);
  const latestAlert = userState.alert_history?.[0];

  function setResearchPreference(next: { market?: ResearchMarket; goal?: ResearchGoal }) {
    trackEvent("onboarding_preference");
    updateUserState((current) => ({
      ...current,
      research_preferences: {
        market: next.market || current.research_preferences?.market || "global",
        goal: next.goal || current.research_preferences?.goal || "opportunity",
        updated_at: new Date().toISOString(),
      },
    }));
  }

  return <main className={`landing-page ${returningAssets.length || latestAlert ? "returning-user" : ""}`}>
    <section className="landing-hero">
      <span className="landing-eyebrow"><TrendingUp size={14} />{t("landingEyebrow")}</span>
      <h1>{t("landingTitle")}</h1>
      <p>{t("landingBody")}</p>
      <div className="landing-search" ref={searchRef}>
        <Search size={20} />
        <SearchField value={query} placeholder={t("search")} label={t("search")} controls="landing-asset-results" expanded={openResults} activeDescendant={shownResults[activeResult] ? `landing-result-${shownResults[activeResult].symbol.replace(/[^a-z0-9]/gi, "-")}` : undefined} onKeyDown={searchKeyDown} onFocus={() => query.trim() && setOpenResults(true)} onChange={(value) => { setQuery(value); setGroup("all"); setOpenResults(Boolean(value.trim())); }} />
        {openResults && query.trim() && <div className="landing-results" id="landing-asset-results" role="listbox">
          {groups.length > 2 && <div className="search-tabs">{groups.map((item) => <button key={item.key} className={item.key === group ? "active" : ""} onClick={() => setGroup(item.key)}>{item.label}<small>{item.count}</small></button>)}</div>}
          {!shownResults.length && remoteLoading ? <Skeleton rows={3} /> : shownResults.map((asset, index) => <div className={`search-result-row ${index === activeResult ? "active" : ""}`} key={asset.symbol} onMouseEnter={() => setActiveResult(index)}>
            <button id={`landing-result-${asset.symbol.replace(/[^a-z0-9]/gi, "-")}`} className="search-result-main" role="option" aria-selected={index === activeResult} onClick={() => { setOpenResults(false); open(asset); }}>
              <AssetLogo asset={asset} size="small" /><span><strong>{displayAssetName(asset, language) || asset.symbol}</strong><small>{asset.symbol}</small></span>
              <em>{localizeAssetType(asset.asset_type, language)} · {localizeSource(asset.data_source, language)}</em>
            </button>
            <div className="search-result-actions"><button onClick={() => { setOpenResults(false); open(asset); }} title={language === "zh" ? "打开详情" : "Open details"}><ExternalLink size={13} /></button><button onClick={() => compare(asset)} title={language === "zh" ? "加入对比" : "Add to comparison"}><Plus size={13} /></button><button onClick={() => alert(asset)} title={language === "zh" ? "设置提醒" : "Set alert"}><Bell size={13} /></button></div>
          </div>)}
          <p className={`search-status ${searchError ? "error" : ""}`}>{searchError ? (language === "zh" ? "网络补充暂不可用，已显示本地结果。" : "Cloud enrichment unavailable; local results are shown.") : remoteLoading ? (language === "zh" ? "已显示本地结果，正在补充网络结果…" : "Local results shown; enriching from the cloud…") : !shownResults.length && remoteComplete ? (language === "zh" ? "没有找到匹配资产，请尝试代码、公司名或行业词。" : "No matches. Try a symbol, company name or industry.") : (language === "zh" ? "支持方向键选择，回车打开。" : "Use arrow keys and Enter to open.")}</p>
        </div>}
      </div>
      {favorites.length < 3 && onboardingCandidates.length > 0 && <section className="watchlist-onboarding">
        <header><span><strong>{language === "zh" ? "用 1 分钟建立每日研究清单" : "Build a daily research queue in one minute"}</strong><small>{language === "zh" ? "先选市场和目标，再关注 3 只资产；下次回来直接看变化。" : "Choose a market and goal, then follow three assets to see what changed on your next visit."}</small></span><b>{favorites.length}/3</b></header>
        <div className="onboarding-preferences">
          <span><small>{language === "zh" ? "常看市场" : "Primary market"}</small><nav>{([
            ["global", language === "zh" ? "全球" : "Global"],
            ["us", language === "zh" ? "美股" : "US"],
            ["a", language === "zh" ? "A股" : "A-shares"],
            ["hk", language === "zh" ? "港股" : "Hong Kong"],
          ] as Array<[ResearchMarket, string]>).map(([value, label]) => <button type="button" key={value} className={researchMarket === value ? "active" : ""} aria-pressed={researchMarket === value} onClick={() => setResearchPreference({ market: value })}>{label}</button>)}</nav></span>
          <span><small>{language === "zh" ? "研究目标" : "Research goal"}</small><nav>{([
            ["opportunity", language === "zh" ? "发现机会" : "Find opportunities"],
            ["risk", language === "zh" ? "控制风险" : "Manage risk"],
            ["learn", language === "zh" ? "学习预测" : "Learn forecasts"],
          ] as Array<[ResearchGoal, string]>).map(([value, label]) => <button type="button" key={value} className={researchGoal === value ? "active" : ""} aria-pressed={researchGoal === value} onClick={() => setResearchPreference({ goal: value })}>{label}</button>)}</nav></span>
        </div>
        <div className="watchlist-onboarding-assets">{onboardingCandidates.map((asset) => <article key={asset.symbol}><Link href={assetPath(asset.symbol)}><AssetLogo asset={asset} size="small" /><span><strong>{displayAssetName(asset, language) || asset.symbol}</strong><small>{asset.symbol}</small></span></Link><button type="button" onClick={() => toggleFavorite(asset)}><Plus size={13} />{language === "zh" ? "关注" : "Follow"}</button></article>)}</div>
        <p>{language === "zh" ? "偏好与清单会保存在当前设备；登录后可跨设备同步并开启每日邮件摘要。" : "Preferences and the queue are saved on this device; sign in for sync and daily email summaries."}</p>
      </section>}
      {(returningAssets.length > 0 || latestAlert) && <section className="returning-home">
        <header><span><strong>{language === "zh" ? "继续研究" : "Continue research"}</strong><small>{language === "zh" ? "回到最近查看与收藏资产" : "Resume recent and saved assets"}</small></span><Link href="/favorites/">{language === "zh" ? "观察列表" : "Watchlist"}<ArrowRight size={12} /></Link></header>
        {returningAssets.length > 0 && <div className="returning-assets">{returningAssets.map((asset) => <Link key={asset.symbol} href={assetPath(asset.symbol)}><AssetLogo asset={asset} size="small" /><span><strong>{displayAssetName(asset, language)}</strong><small>{asset.symbol}</small></span><ArrowRight size={13} /></Link>)}</div>}
        {latestAlert && <Link className="returning-alert" href={assetPath(latestAlert.symbol)}><Bell size={14} /><span><strong>{language === "zh" ? "最近提醒已触发" : "Latest alert triggered"}</strong><small>{latestAlert.symbol} · {new Date(latestAlert.triggered_at).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}</small></span><ArrowRight size={13} /></Link>}
      </section>}
      <ResearchHabitCard recentAssets={recents} />
      <DailyResearchBrief />
      {(returningAssets.length > 0 || favorites.length > 0) && <WatchlistChangeSummary />}
      <div className="landing-actions">
        <Link href="/recommendations/"><b>01</b><Sparkles size={15} /><span><strong>{language === "zh" ? "找研究候选" : "Find candidates"}</strong><small>{language === "zh" ? "先按趋势、风险和估值缩小范围" : "Narrow the field by trend, risk and valuation"}</small></span></Link>
        <Link href="/screener/"><b>02</b><ListFilter size={15} /><span><strong>{language === "zh" ? "做条件筛选" : "Apply conditions"}</strong><small>{language === "zh" ? "按行业、涨幅、估值和信号继续筛选" : "Filter by sector, return, valuation and signal"}</small></span></Link>
        <Link href="/track-record/"><b>03</b><BookOpen size={15} /><span><strong>{language === "zh" ? "核对预测成绩" : "Verify the record"}</strong><small>{language === "zh" ? "确认样本、基准优势和模型治理状态" : "Check samples, benchmark edge and governance"}</small></span></Link>
      </div>
      <div className="popular-assets">
        <header className="popular-heading"><small>{t("popular")}</small><nav><Link href="/stocks/">{language === "zh" ? "全部资产" : "All assets"}<ArrowRight size={12} /></Link><Link href="/recommendations/">{language === "zh" ? "推荐页" : "Picks"}<ArrowRight size={12} /></Link></nav><button onClick={refreshPopular} disabled={gainersLoading || gainers.length <= 6} aria-label={t("refreshPopular")} title={t("refreshPopular")}><RefreshCw className={refreshing ? "spin" : ""} size={13} /></button></header>
        <div>{visibleGainers.map((asset) => <Link key={asset.symbol} href={assetPath(asset.symbol)}>
          <AssetLogo asset={asset} size="small" /><span><strong>{displayAssetName(asset, language) || asset.symbol}</strong><small>{asset.symbol}</small></span>
          <aside>{asset.return_1y !== null && <b className="positive" title={t("return1y")}>{formatPercent(asset.return_1y, true)}</b>}<ArrowRight size={14} /></aside>
        </Link>)}</div>
      </div>
      {scoreboard && <section className="forecast-scoreboard">
        <header><span><Sparkles size={14} /><strong>{language === "zh" ? "预测战绩" : "Forecast record"}</strong></span><small>{language === "zh" ? "核心验证样本：SPY、QQQ、NVDA" : "Core validation sample: SPY, QQQ and NVDA"} · {scoreboard.data_as_of}</small><Link href="/track-record/">{language === "zh" ? "完整成绩" : "Full record"}<ArrowRight size={12} /></Link></header>
        <div>
          <article><small>{language === "zh" ? "走步回测样本" : "Walk-forward samples"}</small><strong>{backtestAll?.completed ?? 0}</strong><span>{language === "zh" ? "与真实冻结预测分开统计" : "Reported separately from frozen live calls"}</span></article>
          <article><small>{language === "zh" ? "回测方向优势" : "Backtest direction edge"}</small><strong className={Number(backtestAll?.direction_edge ?? 0) > 0 ? "positive" : "negative"}>{formatMetricPercent(backtestAll?.direction_edge, true)}</strong><span>{language === "zh" ? `多数类基准 ${formatMetricPercent(backtestAll?.majority_baseline_accuracy)}` : `Majority baseline ${formatMetricPercent(backtestAll?.majority_baseline_accuracy)}`}</span></article>
          <article><small>{language === "zh" ? "真实冻结样本" : "Frozen live samples"}</small><strong>{liveAll?.completed ?? 0}</strong><span>{language === "zh" ? `方向优势 ${formatMetricPercent(liveAll?.direction_edge, true)}` : `Direction edge ${formatMetricPercent(liveAll?.direction_edge, true)}`}</span></article>
          <article><small>{language === "zh" ? "多周期验证" : "Multi-horizon validation"}</small><strong>{horizonStats.length}</strong><span>{horizonStats.map((item) => `${item.horizon} ${formatMetricPercent(item.direction_accuracy)}`).join(" · ")}</span></article>
        </div>
        {liveTrend && <p className="scoreboard-trend"><strong className={Number(liveTrend.recent?.direction_edge ?? 0) > 0 ? "positive" : "negative"}>{language === "zh" ? "近 20 期真实优势" : "Latest 20 live edge"} {formatMetricPercent(liveTrend.recent?.direction_edge, true)}</strong><span>{liveTrend.delta === null ? (language === "zh" ? `样本 ${liveTrend.recent?.completed ?? 0}/20，暂不判断趋势` : `${liveTrend.recent?.completed ?? 0}/20 samples; trend unavailable`) : (language === "zh" ? `较全部样本${liveTrend.delta >= 0 ? "改善" : "恶化"} ${formatMetricPercent(Math.abs(liveTrend.delta))}` : `${formatMetricPercent(Math.abs(liveTrend.delta))} ${liveTrend.delta >= 0 ? "better" : "worse"} than the full sample`)}</span></p>}
        <p className={validationReady ? "positive" : "scoreboard-warning"}>{validationReady ? (language === "zh" ? "当前核心模型已通过基础验证门槛；仍需结合单个资产风险和失效位判断。" : "The core model currently passes the base validation gates; asset-specific risk and invalidation still matter.") : (language === "zh" ? "当前模型尚未证明优于简单基准，首页预测仅作为研究值，不形成买卖结论。" : "The current model has not yet beaten the simple baseline; homepage forecasts are research values, not trade conclusions.")}</p>
      </section>}
      {overview && <section className="market-discovery"><header><strong>{language === "zh" ? "今日市场" : "Today’s market"}</strong><small>{overview.data_as_of}</small></header><div className="discovery-columns">{overviewGroups.map((group) => <article key={group.title}><h3>{group.title}</h3>{group.items.slice(0, 3).map((asset) => <Link key={asset.symbol} href={assetPath(asset.symbol)}><span><strong>{displayAssetName(asset, language)}</strong><small>{asset.symbol}</small></span><b className={group.tone(asset)}>{group.value(asset)}</b></Link>)}</article>)}</div></section>}
    </section>
  </main>;
}
