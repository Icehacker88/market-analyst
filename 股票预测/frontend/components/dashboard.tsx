"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compareAssets, getCompanyResearch, getForecast, getHistory, getMarketSnapshots, getPerformance, getPeriodReturns, getPredictionHistory, resolveAssets } from "@/lib/api";
import { assetPath, catalogAssetBySymbol } from "@/lib/asset-catalog";
import { trackEvent } from "@/lib/analytics";
import { canonicalizeAsset } from "@/lib/assets";
import { comparisonColor } from "@/lib/comparison-colors";
import { dashboardDestination, parseDashboardViewState, rememberRecentSymbol, replaceDashboardLocation, saveComparisonDraft, type DashboardViewState, type DetailTab } from "@/lib/dashboard-state";
import { compareSeriesFromHistory, FULL_HISTORY_START, isLongHistoryRange, sliceCompareSeries } from "@/lib/history-series";
import { periodReturn } from "@/lib/periods";
import { scheduleBackgroundTask } from "@/lib/network";
import { addSymbol, parseSymbols, removeSymbol, startForRange } from "@/lib/selection";
import type { Asset, CompanyResearch, CompareSeries, Forecast, History, Performance, PeriodReturns, PredictionHistory } from "@/lib/types";
import type { DetailDataKind } from "./detail-panel";
import { OverviewCard } from "./overview-card";
import { ComparisonDecisionTable } from "./comparison-decision-table";
import { PeriodReturnStrip } from "./period-return-strip";
import { useApp } from "./providers";
import { SearchAssets } from "./search-assets";
import { ErrorState, LoadingState } from "./states";

const ComparisonChart = dynamic(() => import("./comparison-chart").then((module) => module.ComparisonChart), { ssr: false });
const DetailPanel = dynamic(() => import("./detail-panel").then((module) => module.DetailPanel), { ssr: false, loading: () => <LoadingState /> });
const PredictionHero = dynamic(() => import("./detail-panel").then((module) => module.PredictionHero), { ssr: false });

type AssetBundle = {
  history?: History;
  summary?: History;
  historyStart?: string;
  forecast?: Forecast;
  forecastLoading?: boolean;
  forecastError?: string;
  performance?: Performance;
  predictions?: PredictionHistory;
  research?: CompanyResearch;
  error?: string;
  loading: boolean;
  researchLoading?: boolean;
  performanceLoading?: boolean;
  predictionsLoading?: boolean;
};

const RECENT_RETURN_RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y"] as const;
const FULL_RETURN_RANGES = [...RECENT_RETURN_RANGES, "5Y", "10Y", "MAX"] as const;

function periodReturnsFromHistory(history: History, longTermComplete = false): PeriodReturns {
  const now = new Date(`${history.data_as_of}T12:00:00Z`);
  const ranges = longTermComplete ? FULL_RETURN_RANGES : RECENT_RETURN_RANGES;
  return {
    symbol: history.symbol,
    data_as_of: history.data_as_of,
    returns: Object.fromEntries(ranges.map((item) => [item, periodReturn(history.records, item, now)])),
    long_term_complete: longTermComplete,
  };
}

function mergePeriodReturns(previous: PeriodReturns | undefined, incoming: PeriodReturns): PeriodReturns {
  if (!previous) return incoming;
  return {
    ...incoming,
    long_term_complete: Boolean(previous.long_term_complete || incoming.long_term_complete),
    returns: { ...previous.returns, ...incoming.returns },
  };
}

export function Dashboard({ initialSymbols = [] }: { initialSymbols?: string[] }) {
  const { language, t } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const initialSymbolKey = initialSymbols.join(",");
  const symbolsParam = params.get("symbols") || "";
  const symbols = useMemo(() => {
    const fromUrl = parseSymbols(symbolsParam);
    return fromUrl.length ? fromUrl : parseSymbols(initialSymbolKey);
  }, [initialSymbolKey, symbolsParam]);
  const initialView = useRef(parseDashboardViewState(params, symbols[0] || "")).current;
  const [assets, setAssets] = useState<Asset[]>([]);
  const [bundles, setBundles] = useState<Record<string, AssetBundle>>({});
  const [series, setSeries] = useState<CompareSeries[]>([]);
  const [fullSeries, setFullSeries] = useState<Record<string, CompareSeries>>({});
  const [fullHistoryErrors, setFullHistoryErrors] = useState<Record<string, string>>({});
  const [periodReturns, setPeriodReturns] = useState<Record<string, PeriodReturns>>({});
  const [compareErrors, setCompareErrors] = useState<{ symbol: string; message: string }[]>([]);
  const [range, setRange] = useState(initialView.range);
  const [normalized, setNormalized] = useState(initialView.normalized);
  const [isolatedSymbol, setIsolatedSymbol] = useState<string | null>(initialView.isolated);
  const [active, setActive] = useState(initialView.active || symbols[0] || "");
  const [detailTab, setDetailTab] = useState<DetailTab>(initialView.tab);
  const [limitReached, setLimitReached] = useState(false);
  const pendingDetail = useRef(new Set<string>());
  const failedDetail = useRef(new Set<string>());
  const pendingForecasts = useRef(new Set<string>());
  const loadedForecasts = useRef(new Set<string>());
  const pendingReturns = useRef(new Set<string>());
  const loadedFullReturns = useRef(new Set<string>());
  const pendingFullHistories = useRef(new Set<string>());
  const loadedFullHistories = useRef(new Set<string>());
  const loadSequence = useRef(0);
  const viewed = useRef(new Set<string>());
  const rangeStart = startForRange(range);
  const longHistoryRange = isLongHistoryRange(range);
  const loadStart = longHistoryRange ? startForRange("1Y") : rangeStart;
  const singleAsset = assets.length === 1;
  const viewState = useMemo<DashboardViewState>(() => ({ active, range, normalized, isolated: isolatedSymbol, tab: detailTab }), [active, detailTab, isolatedSymbol, normalized, range]);

  const updateSymbols = useCallback((next: string[], preferredActive?: string) => {
    const nextActive = preferredActive && next.includes(preferredActive) ? preferredActive : next.includes(active) ? active : next[0] || "";
    setActive(nextActive);
    saveComparisonDraft(localStorage, next);
    if (nextActive) rememberRecentSymbol(localStorage, nextActive);
    router.replace(dashboardDestination(next, { ...viewState, active: nextActive, isolated: next.includes(isolatedSymbol || "") ? isolatedSymbol : null }), { scroll: false });
  }, [active, isolatedSymbol, router, viewState]);

  const updateView = useCallback((patch: Partial<DashboardViewState>) => {
    const next = { ...viewState, ...patch };
    replaceDashboardLocation(window.history, dashboardDestination(symbols, next));
  }, [symbols, viewState]);

  useEffect(() => {
    const next = parseDashboardViewState(params, symbols[0] || "");
    setRange(next.range);
    setNormalized(next.normalized);
    setDetailTab(next.tab);
    setIsolatedSymbol(next.isolated && symbols.includes(next.isolated) ? next.isolated : null);
    if (next.active && symbols.includes(next.active)) setActive(next.active);
  }, [params, symbols]);

  useEffect(() => {
    if (!symbols.length) { setAssets([]); return; }
    const local = new Map(symbols
      .map((symbol) => catalogAssetBySymbol(symbol))
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
      .map((asset) => [asset.symbol, canonicalizeAsset(asset)]));
    setAssets((current) => symbols
      .map((symbol) => local.get(symbol) || current.find((asset) => asset.symbol === symbol))
      .filter((asset): asset is Asset => Boolean(asset)));
    const missing = symbols.filter((symbol) => !local.has(symbol));
    if (!missing.length) return;
    let cancelled = false;
    resolveAssets(missing)
      .then((resolved) => {
        if (cancelled) return;
        const remote = new Map(resolved.map(canonicalizeAsset).map((asset) => [asset.symbol, asset]));
        setAssets((current) => symbols
          .map((symbol) => local.get(symbol) || remote.get(symbol) || current.find((asset) => asset.symbol === symbol))
          .filter((asset): asset is Asset => Boolean(asset)));
      })
      .catch(() => { /* Keep immediate local and optimistic search results. */ });
    return () => { cancelled = true; };
  }, [symbols]);

  useEffect(() => {
    if (!active && symbols[0]) setActive(symbols[0]);
  }, [active, symbols]);

  useEffect(() => {
    if (isolatedSymbol && !symbols.includes(isolatedSymbol)) setIsolatedSymbol(null);
  }, [isolatedSymbol, symbols]);

  useEffect(() => {
    if (!active || viewed.current.has(active)) return;
    viewed.current.add(active);
    rememberRecentSymbol(localStorage, active);
    trackEvent("asset_view");
  }, [active]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    if (!assets.length) { setSeries([]); return; }
    setBundles((current) => Object.fromEntries(assets.map((asset) => [asset.symbol, {
      ...(current[asset.symbol] || {}),
      loading: !(current[asset.symbol]?.history || current[asset.symbol]?.summary),
    }])));
    if (assets.length === 1) {
      const asset = assets[0];
      try {
        const history = await getHistory(asset, loadStart);
        if (sequence !== loadSequence.current) return;
        const item = compareSeriesFromHistory(history);
        setSeries([item]);
        setCompareErrors([]);
        setPeriodReturns((current) => {
          const recent = periodReturnsFromHistory(history);
          return { ...current, [asset.symbol]: mergePeriodReturns(current[asset.symbol], recent) };
        });
        setBundles((current) => ({
          ...current,
          [asset.symbol]: {
            ...(current[asset.symbol] || {}),
            history,
            summary: history,
            historyStart: loadStart,
            loading: false,
            error: undefined,
          },
        }));
      } catch {
        if (sequence !== loadSequence.current) return;
        setSeries([]);
        setCompareErrors([{ symbol: asset.symbol, message: t("marketDataUnavailable") }]);
        setBundles((current) => ({
          ...current,
          [asset.symbol]: { ...(current[asset.symbol] || {}), loading: false, error: t("marketDataUnavailable") },
        }));
      }
      return;
    }
    const comparison = await compareAssets(assets, loadStart).catch(() => ({ series: [], errors: assets.map((asset) => ({ symbol: asset.symbol, message: t("comparisonUnavailable") })) }));
    if (sequence !== loadSequence.current) return;
    const seriesBySymbol = new Map(comparison.series.map((item) => [item.symbol, item]));
    if (comparison.series.length) setSeries(comparison.series);
    if (comparison.series.length) {
      setPeriodReturns((current) => {
        const next = { ...current };
        comparison.series.forEach((item) => {
          const recent = periodReturnsFromHistory({
            symbol: item.symbol,
            data_source: item.data_source,
            data_as_of: item.data_as_of,
            snapshot: item.snapshot || {},
            records: item.points.map((point) => ({ Date: point.date, Price: point.price })),
          });
          next[item.symbol] = mergePeriodReturns(current[item.symbol], recent);
        });
        return next;
      });
    }
    setCompareErrors(comparison.errors);
    setBundles((current) => {
      const next = { ...current };
      assets.forEach((asset) => {
        const item = seriesBySymbol.get(asset.symbol);
        const summary: History | undefined = item ? {
          symbol: item.symbol,
          data_source: item.data_source,
          data_as_of: item.data_as_of,
          snapshot: item.snapshot || {},
          records: item.points.map((point) => ({ Date: point.date, Price: point.price })),
        } : undefined;
        next[asset.symbol] = {
          ...(current[asset.symbol] || {}),
          loading: false,
          ...(summary ? { summary } : {}),
          error: item || current[asset.symbol]?.history || current[asset.symbol]?.summary ? undefined : t("marketDataUnavailable"),
        };
      });
      return next;
    });
  }, [assets, loadStart, t]);

  const loadForecast = useCallback(async (symbol: string, force = false) => {
    if (!symbol || pendingForecasts.current.has(symbol) || (!force && loadedForecasts.current.has(symbol))) return;
    pendingForecasts.current.add(symbol);
    setBundles((current) => ({ ...current, [symbol]: { ...(current[symbol] || { loading: false }), forecastLoading: true, forecastError: undefined } }));
    try {
      const forecast = await getForecast(symbol, force);
      loadedForecasts.current.add(symbol);
      setBundles((current) => ({ ...current, [symbol]: { ...(current[symbol] || { loading: false }), forecast, forecastLoading: false, forecastError: undefined } }));
    } catch {
      setBundles((current) => ({ ...current, [symbol]: { ...(current[symbol] || { loading: false }), forecastLoading: false, forecastError: language === "zh" ? "预测暂时不可用，行情仍可正常查看。" : "Forecast is temporarily unavailable; market data remains available." } }));
    } finally {
      pendingForecasts.current.delete(symbol);
    }
  }, [language]);

  const refresh = useCallback(() => {
    void load();
    if (active) {
      loadedForecasts.current.delete(active);
      void loadForecast(active, true);
    }
  }, [active, load, loadForecast]);

  const loadDetailData = useCallback((symbol: string, kind: DetailDataKind) => {
    const key = `${symbol}:${kind}`;
    const current = bundles[symbol];
    if (pendingDetail.current.has(key) || failedDetail.current.has(key) || current?.[kind]) return;
    pendingDetail.current.add(key);
    const loadingKey = `${kind}Loading` as "researchLoading" | "performanceLoading" | "predictionsLoading";
    setBundles((previous) => ({ ...previous, [symbol]: { ...(previous[symbol] || { loading: false }), [loadingKey]: true } }));
    const loader = kind === "research"
      ? getCompanyResearch(symbol)
      : kind === "performance"
        ? getPerformance(symbol)
        : getPredictionHistory(symbol);
    loader
      .then((value) => {
        failedDetail.current.delete(key);
        setBundles((previous) => ({ ...previous, [symbol]: { ...(previous[symbol] || { loading: false }), [kind]: value, [loadingKey]: false } }));
      })
      .catch(() => {
        failedDetail.current.add(key);
        setBundles((previous) => ({ ...previous, [symbol]: { ...(previous[symbol] || { loading: false }), [loadingKey]: false } }));
      })
      .finally(() => pendingDetail.current.delete(key));
  }, [bundles]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!active) return;
    void loadForecast(active);
    const timers = assets
      .filter((asset) => asset.symbol !== active)
      .map((asset, index) => window.setTimeout(() => { void loadForecast(asset.symbol); }, 900 + index * 450));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [active, assets, loadForecast]);

  useEffect(() => {
    const asset = assets.find((item) => item.symbol === active);
    if (assets.length === 1 || !asset || bundles[asset.symbol]?.historyStart === loadStart) return;
    getHistory(asset, loadStart)
      .then((history) => setBundles((current) => ({ ...current, [asset.symbol]: { ...(current[asset.symbol] || { loading: false }), history, historyStart: loadStart, error: undefined } })))
      .catch(() => setBundles((current) => ({ ...current, [asset.symbol]: { ...(current[asset.symbol] || { loading: false }), error: t("marketDataUnavailable") } })));
  }, [active, assets, bundles, loadStart, t]);

  const loadReturns = useCallback(async (symbol: string, scope: "recent" | "full") => {
    const key = `${symbol}:${scope}`;
    if (pendingReturns.current.has(key)) return;
    if (scope === "recent" && periodReturns[symbol]) return;
    if (scope === "full" && periodReturns[symbol]?.long_term_complete) return;
    pendingReturns.current.add(key);
    try {
      const data = await getPeriodReturns(symbol, scope);
      setPeriodReturns((current) => ({ ...current, [symbol]: mergePeriodReturns(current[symbol], data) }));
    } catch {
      // The chart and forecast remain usable when long-range returns are unavailable.
    } finally {
      pendingReturns.current.delete(key);
    }
  }, [periodReturns]);

  const loadFullReturnsFallback = useCallback(async (symbol: string) => {
    const key = `${symbol}:full-fallback`;
    if (loadedFullReturns.current.has(symbol) || pendingReturns.current.has(key)) return;
    pendingReturns.current.add(key);
    try {
      const data = await getPeriodReturns(symbol, "full");
      if (data.long_term_complete) loadedFullReturns.current.add(symbol);
      setPeriodReturns((current) => ({ ...current, [symbol]: mergePeriodReturns(current[symbol], data) }));
    } catch {
      // A previously cached full history can still be used on a later visit.
    } finally {
      pendingReturns.current.delete(key);
    }
  }, []);

  useEffect(() => {
    if (!assets.length) return;
    return scheduleBackgroundTask(() => {
      const pending = assets.filter((asset) => !loadedFullHistories.current.has(asset.symbol) && !pendingFullHistories.current.has(asset.symbol));
      if (!pending.length) return;
      pending.forEach((asset) => pendingFullHistories.current.add(asset.symbol));
      void getMarketSnapshots(pending.map((asset) => asset.symbol), FULL_HISTORY_START, "lite", "history")
        .then((snapshots) => {
          const returned = new Set<string>();
          snapshots.forEach((snapshot) => {
            const symbol = snapshot.asset.symbol;
            returned.add(symbol);
            if (!snapshot.history) {
              setFullHistoryErrors((current) => ({ ...current, [symbol]: t("marketDataUnavailable") }));
              void loadFullReturnsFallback(symbol);
              return;
            }
            loadedFullHistories.current.add(symbol);
            loadedFullReturns.current.add(symbol);
            setFullSeries((current) => ({ ...current, [symbol]: compareSeriesFromHistory(snapshot.history!) }));
            setFullHistoryErrors((current) => { const next = { ...current }; delete next[symbol]; return next; });
            const completeReturns = periodReturnsFromHistory(snapshot.history, true);
            setPeriodReturns((current) => ({ ...current, [symbol]: mergePeriodReturns(current[symbol], completeReturns) }));
          });
          pending.filter((asset) => !returned.has(asset.symbol)).forEach((asset) => {
            setFullHistoryErrors((current) => ({ ...current, [asset.symbol]: t("marketDataUnavailable") }));
            void loadFullReturnsFallback(asset.symbol);
          });
        })
        .catch(() => pending.forEach((asset) => {
          setFullHistoryErrors((current) => ({ ...current, [asset.symbol]: t("marketDataUnavailable") }));
          void loadFullReturnsFallback(asset.symbol);
        }))
        .finally(() => pending.forEach((asset) => pendingFullHistories.current.delete(asset.symbol)));
    }, { fastDelay: 450, constrainedDelay: 2200, timeout: 1800 });
  }, [assets, loadFullReturnsFallback, t]);

  useEffect(() => {
    if (!longHistoryRange || !assets.length) return;
    const available = assets
      .map((asset) => fullSeries[asset.symbol])
      .filter((item): item is CompareSeries => Boolean(item))
      .map((item) => sliceCompareSeries(item, rangeStart));
    if (available.length) setSeries(available);
    const errors = assets
      .filter((asset) => fullHistoryErrors[asset.symbol])
      .map((asset) => ({ symbol: asset.symbol, message: fullHistoryErrors[asset.symbol] }));
    setCompareErrors(errors);
  }, [assets, fullHistoryErrors, fullSeries, longHistoryRange, rangeStart]);

  useEffect(() => {
    if (!active) return;
    const recentTimer = window.setTimeout(() => { void loadReturns(active, "recent"); }, 4500);
    return () => window.clearTimeout(recentTimer);
  }, [active, loadReturns]);

  return (
    <main className={`page-shell ${singleAsset ? "single-asset-page" : "multi-asset-page"}`}>
      <SearchAssets selected={assets} limitReached={limitReached} onAdd={(asset) => {
        const result = addSymbol(symbols, asset.symbol);
        setLimitReached(result.limited);
        if (!result.limited) {
          const optimistic = canonicalizeAsset(asset);
          setAssets((current) => [...new Map([...current, optimistic].map((item) => [item.symbol, item])).values()]);
          updateSymbols(result.symbols, optimistic.symbol);
        }
      }} onOpen={(asset) => router.push(assetPath(asset.symbol))} onAlert={(asset) => router.push(`/favorites/?alert=${encodeURIComponent(asset.symbol)}`)} onRemove={(symbol) => { setLimitReached(false); updateSymbols(removeSymbol(symbols, symbol)); }} onClear={() => updateSymbols([])} />
      <section className="control-row">
        <label className="switch-label">{normalized ? t("normalized") : t("actual")}<button className={`switch ${normalized ? "on" : ""}`} onClick={() => { const next = !normalized; setNormalized(next); updateView({ normalized: next }); }} aria-pressed={normalized}><i /></button></label>
      </section>
      {assets.length > 1 && <section className="overview-grid">{assets.map((asset, index) => <div className={`overview-button ${active === asset.symbol ? "active" : ""}`} key={asset.symbol}><OverviewCard asset={asset} history={bundles[asset.symbol]?.history || bundles[asset.symbol]?.summary} forecast={bundles[asset.symbol]?.forecast} forecastLoading={bundles[asset.symbol]?.forecastLoading} loading={bundles[asset.symbol]?.loading ?? true} seriesColor={comparisonColor(index)} onSelect={() => { setActive(asset.symbol); updateView({ active: asset.symbol }); }} /></div>)}</section>}
      {active && bundles[active]?.forecastLoading && <LoadingState compact label={language === "zh" ? "行情已显示，正在生成当前资产预测…" : "Market data is ready; generating the active forecast…"} />}
      {active && bundles[active]?.forecastError && <ErrorState compact message={bundles[active].forecastError!} retry={() => { loadedForecasts.current.delete(active); void loadForecast(active, true); }} />}
      {active && bundles[active]?.history && bundles[active]?.forecast && <PredictionHero forecast={bundles[active].forecast!} history={bundles[active].history!} performance={bundles[active].performance} stats={(bundles[active].predictions?.live?.statistics || bundles[active].predictions?.statistics)?.find((item) => item.window === "All")} onOpenEvidence={() => { const button = document.getElementById("tab-predictionHistory") as HTMLButtonElement | null; button?.click(); button?.scrollIntoView({ behavior: "smooth", block: "center" }); }} />}
      <section className={`comparison-panel ${singleAsset ? "single-asset-chart" : ""}`}>
        <header><div><h2>{singleAsset ? (language === "zh" ? "价格走势" : "Price trend") : t("comparison")}</h2><p>{normalized ? t("normalized") : t("actual")}</p></div><div className="as-of">{series.map((item) => <span key={item.symbol}>{item.symbol} · {item.data_as_of}</span>)}</div></header>
        {!singleAsset && <ComparisonDecisionTable items={assets.map((asset) => ({ asset, history: bundles[asset.symbol]?.history || bundles[asset.symbol]?.summary, forecast: bundles[asset.symbol]?.forecast }))} activeSymbol={active} isolatedSymbol={isolatedSymbol} onSelect={(symbol) => { setActive(symbol); updateView({ active: symbol }); }} onToggleIsolation={(symbol) => { const next = isolatedSymbol === symbol ? null : symbol; setIsolatedSymbol(next); updateView({ isolated: next }); }} />}
        {!series.length && !compareErrors.length ? <LoadingState /> : <ComparisonChart series={isolatedSymbol ? series.filter((item) => item.symbol === isolatedSymbol) : series} normalized={normalized} assets={assets} />}
        {active && <PeriodReturnStrip returns={periodReturns[active]?.returns} range={range} onChange={(next) => { setRange(next as typeof range); updateView({ range: next as typeof range }); }} />}
        {compareErrors.length > 0 && <ErrorState message={compareErrors.map((item) => `${item.symbol}: ${item.message}`).join(" · ")} retry={load} />}
      </section>
      {active && assets.find((asset) => asset.symbol === active) && <DetailPanel asset={assets.find((asset) => asset.symbol === active)!} {...(bundles[active] || { loading: true })} loading={!bundles[active]?.history} showHero={false} initialTab={detailTab} onTabChange={(tab) => { setDetailTab(tab); updateView({ tab }); }} detailLoading={{ research: bundles[active]?.researchLoading, performance: bundles[active]?.performanceLoading, predictions: bundles[active]?.predictionsLoading }} loadDetailData={loadDetailData} refresh={refresh} />}
    </main>
  );
}
