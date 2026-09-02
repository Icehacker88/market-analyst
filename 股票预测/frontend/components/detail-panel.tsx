"use client";

import { AppLink as Link } from "./app-link";
import { BellRing, Bookmark, BookmarkCheck, Check, Database, RefreshCw, RotateCcw, Share2, Sparkles, Square, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { runForecast, streamAiAnalysis, taskStatus } from "@/lib/api";
import { compactChatThread, conversationForApi, createChatMessage, dedupeChatMessages } from "@/lib/ai-chat";
import { displayAssetName } from "@/lib/assets";
import { trackEvent } from "@/lib/analytics";
import { forecastBrief } from "@/lib/forecast-brief";
import { forecastCredibility, predictionScore } from "@/lib/forecast-credibility";
import { forecastDecision } from "@/lib/forecast-decision";
import { forecastPassport, type ForecastPassportState } from "@/lib/forecast-passport";
import type { DetailTab } from "@/lib/dashboard-state";
import { formatMetricPercent, formatNumber, formatPercent } from "@/lib/format";
import { localizeModel, localizeQuality, localizeSignal } from "@/lib/i18n";
import { nextReviewDate, reviewReasonLabel, reviewReasonOrder, triggerPriceFor } from "@/lib/research-review";
import type { AiAnalysis, AiChatMessage, Asset, CompanyResearch as Research, DecisionProfile, Forecast, History, Performance, PredictionHistory } from "@/lib/types";
import { AdvancedMarketChart } from "./advanced-market-chart";
import { AssetLogo } from "./asset-logo";
import { CompanyResearch } from "./company-research";
import { useApp } from "./providers";
import { EmptyState, ErrorState, LoadingState } from "./states";
import { UnifiedLineChart } from "./unified-line-chart";

type Tab = DetailTab;
export type DetailDataKind = "research" | "performance" | "predictions";
export function DetailPanel({
  asset,
  history,
  forecast,
  performance,
  predictions,
  research,
  error,
  loading,
  detailLoading = {},
  showHero = true,
  initialTab = "priceReturn",
  onTabChange,
  loadDetailData,
  refresh,
}: {
  asset: Asset;
  history?: History;
  forecast?: Forecast;
  performance?: Performance;
  predictions?: PredictionHistory;
  research?: Research;
  error?: string;
  loading: boolean;
  detailLoading?: Partial<Record<DetailDataKind, boolean>>;
  showHero?: boolean;
  initialTab?: Tab;
  onTabChange?: (tab: Tab) => void;
  loadDetailData: (symbol: string, kind: DetailDataKind) => void;
  refresh: () => void;
}) {
  const { isFavorite, language, t, toggleFavorite, updateUserState, userState } = useApp();
  const [tab, setLocalTab] = useState<Tab>(initialTab);
  const [task, setTask] = useState<Record<string, unknown> | null>(null);
  const [taskError, setTaskError] = useState("");
  const favorite = isFavorite(asset.symbol);
  const latest = history?.records.at(-1);
  const stats = (predictions?.live?.statistics || predictions?.statistics)?.find((item) => item.window === "All");
  const aiChatKey = `${asset.symbol}:${language}`;
  const aiThread = userState.ai_chats?.[aiChatKey];
  const aiMessages = dedupeChatMessages(aiThread?.messages || []);
  const setAiMessages = (updater: AiChatMessage[] | ((current: AiChatMessage[]) => AiChatMessage[])) => {
    updateUserState((current) => {
      const existing = current.ai_chats?.[aiChatKey];
      const messages = typeof updater === "function" ? updater(existing?.messages || []) : updater;
      const thread = compactChatThread(messages, existing?.summary);
      return { ...current, ai_chats: { ...(current.ai_chats || {}), [aiChatKey]: thread } };
    });
  };
  const setTab = (next: Tab) => {
    setLocalTab(next);
    onTabChange?.(next);
  };

  useEffect(() => { setLocalTab(initialTab); }, [initialTab]);

  useEffect(() => {
    if (userState.ai_chats?.[aiChatKey]) return;
    try {
      const stored = JSON.parse(localStorage.getItem("orivane-ai-chats-v1") || "{}") as Record<string, Array<Partial<AiChatMessage>>>;
      const legacy = stored?.[aiChatKey];
      if (!legacy?.length) return;
      const migrated = legacy.map((message) => ({
        ...createChatMessage(message.role === "user" ? "user" : "assistant", String(message.content || "")),
        ...(message.analysis ? { analysis: message.analysis } : {}),
      }));
      setAiMessages(migrated);
    } catch { /* No legacy chat to migrate. */ }
  }, [aiChatKey, userState.ai_chats]);

  useEffect(() => {
    if (tab === "research" && !research && !detailLoading.research) loadDetailData(asset.symbol, "research");
    if (tab === "performance" && !performance && !detailLoading.performance) loadDetailData(asset.symbol, "performance");
    if ((tab === "forecast" || tab === "predictionHistory") && !predictions && !detailLoading.predictions) loadDetailData(asset.symbol, "predictions");
  }, [asset.symbol, detailLoading.performance, detailLoading.predictions, detailLoading.research, loadDetailData, performance, predictions, research, tab]);

  useEffect(() => {
    if (tab === "forecast") trackEvent("forecast_view");
  }, [tab]);

  async function analyze() {
    setTaskError("");
    try {
      setTask({ status: "running", progress: 0 });
      const submitted = await runForecast(asset);
      if (!submitted.task_id) {
        setTask({ status: "completed", progress: 100 });
        refresh();
        return;
      }
      setTask({ ...submitted, status: submitted.status ?? "queued", progress: submitted.progress ?? 0 });
      const id = String(submitted.task_id);
      const timer = setInterval(async () => {
        const next = await taskStatus(id);
        setTask(next);
        if (["completed", "failed"].includes(String(next.status))) {
          clearInterval(timer);
          if (next.status === "completed") refresh();
        }
      }, 1500);
    } catch (cause) {
      setTask(null);
      setTaskError(t("analysisUnavailable"));
    }
  }

  async function shareAsset() {
    const url = window.location.href;
    const title = `${displayAssetName(asset, language) || asset.symbol} ${asset.symbol} · Orivane`;
    const text = forecast
      ? `${language === "zh" ? "未来 1 日/5 日/1 个月预测" : "1D/5D/1M forecast"}: ${formatPercent(forecast.forecast_1d_return, true)} / ${formatPercent(forecast.forecast_5d_return, true)} / ${formatPercent(forecast.forecast_1m_return, true)}`
      : title;
    try {
      if (navigator.share) await navigator.share({ title, text, url });
      else {
        await navigator.clipboard.writeText(url);
        setTaskError(language === "zh" ? "链接已复制" : "Link copied");
      }
    } catch { /* Cancelling the native share sheet is not an error. */ }
  }

  const tabs: Tab[] = ["priceReturn", "research", "technical", "forecast", "performance", "predictionHistory"];

  if (error) return <section className="detail-panel"><ErrorState message={error} retry={refresh} /></section>;
  if (loading || !history) return <section className="detail-panel"><LoadingState /></section>;
  return (
    <section className="detail-panel">
      <header className="detail-head">
        <div><AssetLogo asset={asset} size="large" /><strong>{displayAssetName(asset, language) || asset.symbol}</strong><span>{asset.symbol}</span><b>{formatNumber(history.snapshot.latest_price)}</b><em className={Number(history.snapshot.return_1d) >= 0 ? "positive" : "negative"}>{formatPercent(history.snapshot.return_1d, true)}</em><small>{t("dataAsOf")} {history.data_as_of}</small></div>
        <div className="detail-actions">
          <button onClick={shareAsset}><Share2 size={15} />{language === "zh" ? "分享" : "Share"}</button>
          <button onClick={() => toggleFavorite(asset)}>{favorite ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}{favorite ? t("removeFavorite") : t("addFavorite")}</button>
          <button onClick={analyze} disabled={task?.status === "queued" || task?.status === "running"}><RefreshCw size={15} />{task?.status === "queued" || task?.status === "running" ? `${t("running")} ${task.progress}%` : t("run")}</button>
          {taskError && <small>{taskError}</small>}
        </div>
      </header>
      {showHero && forecast && <PredictionHero forecast={forecast} history={history} performance={performance} stats={stats} onOpenEvidence={() => setTab("predictionHistory")} />}
      <nav className="tabs" role="tablist" aria-label={language === "zh" ? "资产分析栏目" : "Asset analysis sections"} onKeyDown={(event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const current = tabs.indexOf(tab);
        const next = tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
        setTab(next);
        document.getElementById(`tab-${next}`)?.focus();
      }}>
        {tabs.map((item) => <button key={item} id={`tab-${item}`} role="tab" aria-selected={tab === item} aria-controls={`panel-${item}`} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)} className={tab === item ? "active" : ""}>{t(item)}</button>)}
      </nav>
      <div className="tab-content" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "priceReturn" && <PriceReturn history={history} />}
        {tab === "research" && (detailLoading.research ? <LoadingState /> : <CompanyResearch data={research} />)}
        {tab === "technical" && <Technical latest={latest} history={history} />}
        {tab === "forecast" && <ForecastView asset={asset} forecast={forecast} history={history} performance={performance} predictions={predictions} predictionsLoading={detailLoading.predictions} stats={stats} aiMessages={aiMessages} aiSummary={aiThread?.summary} setAiMessages={setAiMessages} />}
        {tab === "performance" && (detailLoading.performance ? <LoadingState /> : <PerformanceView performance={performance} />)}
        {tab === "predictionHistory" && (detailLoading.predictions ? <LoadingState /> : <HistoryView predictions={predictions} />)}
      </div>
    </section>
  );
}

export function PredictionHero({ forecast, history, performance, stats, onOpenEvidence }: { forecast: Forecast; history: History; performance?: Performance; stats?: PredictionHistory["statistics"][number]; onOpenEvidence?: () => void }) {
  const { language, t, updateUserState, userState } = useApp();
  const zh = language === "zh";
  const credibility = forecastCredibility(forecast, history);
  const score = predictionScore(forecast, history, credibility, stats, performance);
  const drivers = forecastDrivers(forecast, history, language);
  const posture = tradingPosture(forecast, score.score, language);
  const decision = forecastDecision(forecast, score.score, language);
  const calibration = forecast.calibration;
  const action = forecast.action;
  const validation = forecast.validation;
  const brief = forecastBrief(forecast, language);
  const passport = forecastPassport(forecast, history.data_as_of);
  const profile: DecisionProfile = userState.decision_profiles?.[forecast.symbol] || { status: "watching", horizon: "10D", risk: "balanced" };
  const savedReview = userState.research_reviews?.[forecast.symbol];
  const tailored = personalizedDecisionAdvice(forecast, history, score.score, profile, language);
  const updateProfile = (next: Partial<DecisionProfile>) => updateUserState((current) => ({
    ...current,
    decision_profiles: { ...(current.decision_profiles || {}), [forecast.symbol]: { ...profile, ...next } },
  }));
  const saveReview = (reason: NonNullable<typeof savedReview>["reason"]) => {
    const review = {
      symbol: forecast.symbol,
      reason,
      due_at: nextReviewDate(reason),
      created_at: new Date().toISOString(),
      reference_price: typeof forecast.base_price === "number" ? forecast.base_price : Number(history.snapshot.latest_price) || null,
      trigger_price: triggerPriceFor(reason, forecast),
      data_as_of: forecast.data_as_of,
    };
    updateUserState((current) => ({ ...current, research_reviews: { ...(current.research_reviews || {}), [forecast.symbol]: review } }));
    trackEvent("research_review_set");
  };
  const clearReview = () => updateUserState((current) => {
    const next = { ...(current.research_reviews || {}) };
    delete next[forecast.symbol];
    return { ...current, research_reviews: next };
  });
  return <section className="prediction-hero">
    <header>
      <span>
        <small>{zh ? "当前决策状态" : "Current decision state"}</small>
        <strong className={decision.className}>{decision.title}</strong>
        <p className="decision-state-reason">{decision.reason}</p>
      </span>
      <b className={`prediction-score ${score.label}`}>{score.score}<small>{zh ? "/100 · 证据质量" : "/100 · evidence"}</small></b>
    </header>
    <div className="prediction-brief">
      <div className="prediction-brief-outlook"><small>{zh ? "模型数值方向" : "Numeric model path"}</small><strong className={brief.tone}>{brief.trend}</strong><span>{brief.outlook}</span></div>
      <button type="button" className="prediction-brief-probability confidence-drilldown" onClick={onOpenEvidence} disabled={!onOpenEvidence}><small>{zh ? "历史同向占比" : "Historical direction share"}</small><strong>{formatMetricPercent(brief.probability)}</strong><span>{brief.probabilityNote} · {zh ? "历史统计，不代表未来概率" : "Historical statistic, not a future probability"}</span></button>
      <div className="prediction-brief-level"><small>{zh ? "预测失效位" : "Invalidation"}</small><strong>{formatNumber(forecast.key_levels?.invalidation)}</strong><span>{zh ? forecast.key_levels?.invalidation_zh || "等待更多数据" : forecast.key_levels?.invalidation_en || "Waiting for more data"}</span></div>
      <div className="prediction-brief-advice"><p><b>{zh ? "已经持有" : "Already holding"}</b><span>{brief.holderAdvice}</span></p><p><b>{zh ? "尚未买入" : "No position yet"}</b><span>{brief.newcomerAdvice}</span></p></div>
    </div>
    <section className="decision-context">
      <header><span><strong>{zh ? "按你的条件调整" : "Tailor to your situation"}</strong><small>{zh ? "仅作条件化研究参考，不是自动交易指令" : "Conditional research reference, not an automated trade instruction"}</small></span><b>{tailored.title}</b></header>
      <div className="decision-controls">
        <label><span>{zh ? "当前状态" : "Position"}</span><select value={profile.status} onChange={(event) => updateProfile({ status: event.target.value as DecisionProfile["status"] })}><option value="watching">{zh ? "尚未持有" : "Watching"}</option><option value="holding">{zh ? "已经持有" : "Holding"}</option></select></label>
        {profile.status === "holding" && <label><span>{zh ? "持仓成本" : "Entry price"}</span><input type="number" inputMode="decimal" value={profile.entry_price ?? ""} placeholder={formatNumber(history.snapshot.latest_price)} onChange={(event) => updateProfile({ entry_price: event.target.value ? Number(event.target.value) : null })} /></label>}
        <label><span>{zh ? "计划周期" : "Horizon"}</span><select value={profile.horizon} onChange={(event) => updateProfile({ horizon: event.target.value as DecisionProfile["horizon"] })}><option value="5D">{zh ? "未来 5 日" : "Next 5D"}</option><option value="10D">{zh ? "未来 10 日" : "Next 10D"}</option><option value="1M">{zh ? "未来 1 个月" : "Next month"}</option></select></label>
        <label><span>{zh ? "风险偏好" : "Risk"}</span><select value={profile.risk} onChange={(event) => updateProfile({ risk: event.target.value as DecisionProfile["risk"] })}><option value="conservative">{zh ? "稳健" : "Conservative"}</option><option value="balanced">{zh ? "均衡" : "Balanced"}</option><option value="aggressive">{zh ? "积极" : "Aggressive"}</option></select></label>
      </div>
      <p>{tailored.body}</p><small>{tailored.guardrail}</small>
    </section>
    <section className="research-follow-up">
      <header><span><BellRing size={15} /><span><strong>{zh ? "保存下一次复核" : "Save the next review"}</strong><small>{zh ? "让研究形成闭环，而不是看完预测就离开" : "Turn this forecast into a follow-up, not a one-off view"}</small></span></span>{savedReview && <button type="button" onClick={clearReview} aria-label={zh ? "删除复核计划" : "Remove review plan"}><X size={13} /></button>}</header>
      {savedReview ? <div className="research-follow-up-saved"><Check size={15} /><span><strong>{reviewReasonLabel(savedReview.reason, language)}</strong><small>{zh ? `计划复核：${new Date(savedReview.due_at).toLocaleDateString("zh-CN")}` : `Review by ${new Date(savedReview.due_at).toLocaleDateString("en-US")}`}{savedReview.trigger_price ? ` · ${zh ? "关键位" : "level"} ${formatNumber(savedReview.trigger_price)}` : ""}</small></span></div> : <div className="research-follow-up-actions">{reviewReasonOrder.map((reason) => {
        const level = triggerPriceFor(reason, forecast);
        return <button type="button" key={reason} onClick={() => saveReview(reason)} disabled={reason !== "next_session" && level === null}><span>{reviewReasonLabel(reason, language)}</span>{level !== null && <small>{formatNumber(level)}</small>}</button>;
      })}</div>}
    </section>
    <details className="prediction-evidence-summary" onToggle={(event) => {
      if (event.currentTarget.open) trackEvent("forecast_evidence_open");
    }}>
      <summary><span><strong>{zh ? "展开预测依据与多周期模型" : "Open evidence and horizon models"}</strong><small>{zh ? "验证优势、相似样本、关键价位与主要驱动因素" : "Validation edge, similar samples, key levels and primary drivers"}</small></span></summary>
      <section className="forecast-passport">
        <header><span><strong>{zh ? "多周期预测凭证" : "Multi-horizon forecast passport"}</strong><small>{zh ? `行情 ${history.data_as_of} · 预测 ${forecast.data_as_of}` : `Market ${history.data_as_of} · forecast ${forecast.data_as_of}`}</small></span><small>{zh ? `生成于 ${new Date(forecast.generated_at).toLocaleString("zh-CN")}` : `Generated ${new Date(forecast.generated_at).toLocaleString("en-US")}`}</small></header>
        <div className="table-wrap"><table className="mobile-card-table"><thead><tr><th>{zh ? "周期" : "Horizon"}</th><th>{zh ? "预测变化" : "Forecast move"}</th><th>{zh ? "预测价格" : "Forecast price"}</th><th>{zh ? "历史同向占比" : "Historical direction share"}</th><th>{zh ? "验证样本" : "Validation samples"}</th><th>{zh ? "相对基准优势" : "Edge vs baseline"}</th><th>{zh ? "状态" : "Status"}</th></tr></thead><tbody>{passport.map((row) => <tr key={row.horizon}>
          <td data-label={zh ? "周期" : "Horizon"}><strong>{row.horizon}</strong><small>{row.model ? localizeModel(row.model, language) : "—"}</small></td>
          <td data-label={zh ? "预测变化" : "Forecast move"} className={Number(row.forecastReturn) >= 0 ? "positive" : "negative"}>{formatPercent(row.forecastReturn, true)}</td>
          <td data-label={zh ? "预测价格" : "Forecast price"}>{formatNumber(row.forecastPrice)}</td>
          <td data-label={zh ? "历史同向占比" : "Historical direction share"}>{formatMetricPercent(row.directionShare)}</td>
          <td data-label={zh ? "验证样本" : "Validation samples"}>{row.validationSamples}</td>
          <td data-label={zh ? "相对基准优势" : "Edge vs baseline"} className={Number(row.directionEdge) > 0 ? "positive" : Number(row.directionEdge) <= 0 ? "negative" : ""}>{formatMetricPercent(row.directionEdge, true)}</td>
          <td data-label={zh ? "状态" : "Status"}><span className={`forecast-passport-status ${row.state}`}>{passportStateLabel(row.state, zh)}</span></td>
        </tr>)}</tbody></table></div>
        <p>{zh ? "“已验证”要求至少 20 个独立验证样本、相对多数类基准优势为正，且该周期模型已通过晋级门槛。" : "Validated requires at least 20 independent holdout samples, positive edge over the majority baseline and a promoted horizon model."}</p>
      </section>
      <div className="prediction-hero-grid">
        <article><small>{zh ? "操作参考" : "Action reference"}</small><strong className={posture.className}>{zh ? action?.label_zh || posture.label : action?.label_en || posture.label}</strong><span>{zh ? action?.summary_zh || posture.body : action?.summary_en || posture.body}</span></article>
        <article><small>{zh ? "走步验证优势" : "Walk-forward edge"}</small><strong className={Number(validation?.backtest.direction_edge ?? 0) > 0 ? "positive" : "negative"}>{formatMetricPercent(validation?.backtest.direction_edge, true)}</strong><span>{zh ? `回测 ${validation?.backtest.samples ?? 0} · 真实冻结 ${validation?.live.samples ?? 0}` : `Backtest ${validation?.backtest.samples ?? 0} · frozen live ${validation?.live.samples ?? 0}`}</span></article>
        <article><small>{zh ? "相似信号" : "Similar signals"}</small><strong>{formatMetricPercent(calibration?.direction_hit_rate)}</strong><span>{zh ? `样本 ${calibration?.sample_size ?? 0} / ${calibration?.total_samples ?? 0}` : `Sample ${calibration?.sample_size ?? 0} / ${calibration?.total_samples ?? 0}`}</span></article>
        <article><small>{zh ? "失效价位" : "Invalidation"}</small><strong>{formatNumber(forecast.key_levels?.invalidation)}</strong><span>{zh ? forecast.key_levels?.invalidation_zh || "等待更多数据" : forecast.key_levels?.invalidation_en || "Waiting for more data"}</span></article>
        <article><small>{t("nextDay")}</small><strong>{formatPercent(forecast.forecast_1d_return, true)}</strong><span>{formatNumber(forecast.forecast_1d_price)}</span></article>
        <article><small>{t("next5d")}</small><strong>{formatPercent(forecast.forecast_5d_return, true)}</strong><span>{formatNumber(forecast.forecast_5d_price)}</span></article>
        <article><small>{zh ? "未来1个月" : "Next month"}</small><strong>{formatPercent(forecast.forecast_1m_return ?? null, true)}</strong><span>{formatNumber(forecast.forecast_1m_price)}</span></article>
      </div>
      <div className="prediction-drivers">
        <strong>{zh ? "主要驱动因素" : "Main drivers"}</strong>
        <ul>{drivers.slice(0, 4).map((driver) => <li key={driver}>{driver}</li>)}</ul>
      </div>
    </details>
  </section>;
}

function passportStateLabel(state: ForecastPassportState, zh: boolean): string {
  const labels: Record<ForecastPassportState, [string, string]> = {
    validated: ["已验证", "Validated"],
    provisional: ["初步正优势", "Provisional positive edge"],
    negative_edge: ["未优于基准", "Below baseline"],
    building: ["样本积累中", "Building evidence"],
    stale: ["预测已过期", "Stale forecast"],
  };
  return labels[state][zh ? 0 : 1];
}

function PriceReturn({ history }: { history: History }) {
  const { t } = useApp();
  return <div className="price-return-layout"><MetricList items={[
    [t("latestPrice"), formatNumber(history.snapshot.latest_price)],
    [t("return5d"), formatPercent(history.snapshot.return_5d, true)],
    [t("volatility20d"), formatPercent(history.snapshot.annualized_volatility_20d)],
    [t("volume"), formatNumber(history.records.at(-1)?.Volume, 0)],
  ]} /><AdvancedMarketChart history={history} /></div>;
}

function Technical({ latest, history }: { latest?: Record<string, unknown>; history: History }) {
  const { t } = useApp();
  if (!latest) return <EmptyState />;
  return <div className="technical-grid"><MetricList items={[
    ["MA5", formatNumber(latest.MA_5)], ["MA20", formatNumber(latest.MA_20)], ["MA50", formatNumber(latest.MA_50)],
    ["RSI14", formatNumber(latest.RSI_14)], ["MACD", formatNumber(latest.MACD, 4)], [t("bollingerUpper"), formatNumber(latest.BB_Upper)],
    [t("bollingerLower"), formatNumber(latest.BB_Lower)], [t("volatility20d"), formatPercent(Number(latest.Rolling_Std_20) * Math.sqrt(252))],
  ]} /><p className="notice">{t("dataAsOf")} {history.data_as_of}</p></div>;
}

function ForecastView({ asset, forecast, history, performance, predictions, predictionsLoading, stats, aiMessages, aiSummary, setAiMessages }: { asset: Asset; forecast?: Forecast; history: History; performance?: Performance; predictions?: PredictionHistory; predictionsLoading?: boolean; stats?: PredictionHistory["statistics"][number]; aiMessages: AiChatMessage[]; aiSummary?: string; setAiMessages: (updater: AiChatMessage[] | ((current: AiChatMessage[]) => AiChatMessage[])) => void }) {
  const { language, t } = useApp();
  if (!forecast) return <EmptyState message={t("noForecast")} />;
  const credibility = forecastCredibility(forecast, history);
  const model = localizeModel(forecast.best_model, language);
  const calibration = forecast.calibration;
  const components = forecast.model_components || [];
  const keyLevels = forecast.key_levels;
  const scenarios = forecast.scenarios || [];
  const action = forecast.action;
  const marketRegime = forecast.market_regime;
  const optimization = forecast.self_optimization;
  const kline = forecast.kline_forecast;
  const expectedRange = forecast.expected_range_1m;
  const oneDayInterval = forecast.forecast_intervals?.find((item) => item.horizon === "1D");
  const validation = forecast.validation;
  const separator = language === "zh" ? "：" : ": ";
  const period = language === "zh" ? "。" : ".";
  const explanation = [
    `${t("forecastModelLine")}${separator}${model}${period}`,
    `${t("forecastReturnLine")}${separator}${formatPercent(forecast.forecast_1d_return, true)}${period}`,
    forecast.best_model === "Cloud Trend" || forecast.best_model === "Orivane Ensemble" ? t("forecastCloudLine") : t("forecastPublishedLine"),
  ];
  const hasModelInterval = Boolean(oneDayInterval);
  const intervalLow = oneDayInterval?.price_low ?? credibility.rangeLow;
  const intervalHigh = oneDayInterval?.price_high ?? credibility.rangeHigh;
  const range = intervalLow !== null && intervalHigh !== null
    ? `${formatNumber(intervalLow)} – ${formatNumber(intervalHigh)}`
    : "—";
  const unverified = (stats?.completed ?? 0) === 0;
  const evidence = evidenceLevel(credibility.stale, unverified, stats?.completed ?? 0, language);
  const score = predictionScore(forecast, history, credibility, stats, performance);
  const posture = tradingPosture(forecast, score.score, language);
  return <div className="forecast-stack">
    <div className="forecast-status current">
      <strong>{language === "zh" ? "自动预测已生成" : "Forecast generated"}</strong>
      <span>{language === "zh" ? "基于当前历史行情、均线、动量、波动率和均值回归计算，用于走势判断和交易前研究。" : "Built from current history, moving averages, momentum, volatility and mean reversion for pre-trade research."}</span>
    </div>
    <div className="forecast-core-grid">
      {[
        [t("nextDay"), forecast.forecast_1d_return, forecast.forecast_1d_price],
        [t("next5d"), forecast.forecast_5d_return, forecast.forecast_5d_price],
        [language === "zh" ? "未来10日" : "Next 10D", forecast.forecast_10d_return, forecast.forecast_10d_price],
        [language === "zh" ? "未来1个月" : "Next month", forecast.forecast_1m_return, forecast.forecast_1m_price],
      ].map(([label, value, price]) => <article key={String(label)}><small>{String(label)}</small><strong className={Number(value) >= 0 ? "positive" : "negative"}>{formatPercent(value, true)}</strong><span>{formatNumber(price)}</span></article>)}
      <article><small>{language === "zh" ? "可信度" : "Confidence"}</small><strong>{score.score}/100</strong><span>{language === "zh" ? "历史校准与验证综合评分" : "Combined historical calibration score"}</span></article>
      <article><small>{language === "zh" ? "失效价位" : "Invalidation"}</small><strong>{formatNumber(keyLevels?.invalidation)}</strong><span>{language === "zh" ? keyLevels?.invalidation_zh || "等待更多数据" : keyLevels?.invalidation_en || "Waiting for data"}</span></article>
    </div>
    <ForecastContextPanel forecast={forecast} />
    <ForecastEvolution forecast={forecast} predictions={predictions} loading={predictionsLoading} />
    <details className="forecast-disclosure">
      <summary><span><strong>{language === "zh" ? "依据与验证" : "Evidence and validation"}</strong><small>{language === "zh" ? "查看可信度、相似信号、市场状态和优化状态" : "Confidence, similar signals, regime and optimizer status"}</small></span></summary>
      <div className="forecast-credibility-grid">
      <article><small>{language === "zh" ? "操作参考" : "Action reference"}</small><strong className={posture.className}>{posture.label}</strong><span>{posture.body}</span></article>
      <article><small>{language === "zh" ? "可信度" : "Confidence"}</small><strong>{score.score}/100</strong><span>{evidence.body}</span></article>
      <article><small>{language === "zh" ? "相似信号校准" : "Similar-signal calibration"}</small><strong>{formatMetricPercent(calibration?.direction_hit_rate)}</strong><span>{language === "zh" ? calibration?.note_zh || "暂无相似样本" : calibration?.note_en || "No similar sample yet"}</span></article>
      <article><small>{language === "zh" ? "市场状态" : "Market regime"}</small><strong>{language === "zh" ? marketRegime?.label_zh || "—" : marketRegime?.label_en || "—"}</strong><span>{marketRegime?.benchmark_symbol ? `${marketRegime.benchmark_symbol} ${formatPercent(marketRegime.benchmark_return_5d, true)}` : (language === "zh" ? "基于标的自身趋势识别" : "Asset-only regime")}</span></article>
      <article><small>{language === "zh" ? "自动权重优化" : "Automatic weight tuning"}</small><strong>{optimization?.active ? (language === "zh" ? "留出验证通过" : "Holdout passed") : (language === "zh" ? "使用基准权重" : "Baseline weights")}</strong><span>{optimization ? `${optimization.version} · ${optimization.sample_size}/${optimization.min_sample_size}` : (language === "zh" ? "等待验证样本" : "Waiting for validation samples")}</span></article>
      <article><small>{language === "zh" ? "K线序列" : "K-line sequence"}</small><strong>{language === "zh" ? kline?.label_zh || "—" : kline?.label_en || "—"}</strong><span>{kline ? `${language === "zh" ? "得分" : "Score"} ${kline.score.toFixed(2)} · ATR20 ${formatNumber(kline.atr_20)}` : "—"}</span></article>
      </div>
    </details>
    <details className="forecast-disclosure">
      <summary><span><strong>{language === "zh" ? "完整指标与风险参数" : "Full metrics and risk parameters"}</strong><small>{language === "zh" ? "模型、关键价位、区间校准与样本统计" : "Model, key levels, intervals and sample statistics"}</small></span></summary>
    <div className="forecast-layout">
      <div className="signal-block">
        <small>{language === "zh" ? "方向倾向" : "Direction bias"}</small>
        <strong className={forecast.forecast_1d_return >= 0 ? "positive" : "negative"}>{forecast.forecast_1d_return >= 0 ? (language === "zh" ? "短线偏多" : "Short-term up") : (language === "zh" ? "短线偏空" : "Short-term down")}</strong>
        <span>{localizeQuality(forecast.signal_quality, language)}</span>
      </div>
      <MetricList items={[
        [t("model"), model],
        [t("nextDay"), `${formatNumber(forecast.forecast_1d_price)} · ${formatPercent(forecast.forecast_1d_return, true)}`],
        [t("next5d"), `${formatNumber(forecast.forecast_5d_price)} · ${formatPercent(forecast.forecast_5d_return, true)}`],
        [language === "zh" ? "未来10日" : "Next 10D", `${formatNumber(forecast.forecast_10d_price)} · ${formatPercent(forecast.forecast_10d_return ?? null, true)}`],
        [language === "zh" ? "未来1个月" : "Next month", `${formatNumber(forecast.forecast_1m_price)} · ${formatPercent(forecast.forecast_1m_return ?? null, true)}`],
        [language === "zh" ? "预测可信度" : "Forecast confidence", `${score.score}/100`],
        [language === "zh" ? "操作建议" : "Action", language === "zh" ? action?.label_zh || "—" : action?.label_en || "—"],
        [language === "zh" ? "支撑位" : "Support", formatNumber(keyLevels?.support)],
        [language === "zh" ? "压力位" : "Resistance", formatNumber(keyLevels?.resistance)],
        [language === "zh" ? "止损参考" : "Stop reference", formatNumber(keyLevels?.stop_loss)],
        [language === "zh" ? "突破位" : "Breakout", formatNumber(keyLevels?.breakout)],
        [hasModelInterval ? (language === "zh" ? "90%经验误差区间" : "90% empirical error interval") : t("estimatedRange"), range],
        [language === "zh" ? "区间校准样本" : "Interval calibration samples", String(oneDayInterval?.calibration_samples ?? 0)],
        [language === "zh" ? "区间独立验证样本" : "Interval holdout samples", String(oneDayInterval?.validation_samples ?? 0)],
        [language === "zh" ? "区间独立覆盖率" : "Holdout interval coverage", formatMetricPercent(oneDayInterval?.empirical_coverage)],
        [t("risk"), forecast.risk ? formatPercent(forecast.risk.Risk_5D_Probability) : "—"],
        [t("forecastDataDate"), credibility.forecastDate],
        [t("marketDataDate"), credibility.marketDate],
        [t("validationSamples"), String(forecast.validation_sample_size ?? 0)],
        [language === "zh" ? "相似样本" : "Similar samples", `${calibration?.sample_size ?? 0}`],
        [language === "zh" ? "相似命中率" : "Similar hit rate", formatMetricPercent(calibration?.direction_hit_rate)],
        [language === "zh" ? "相似 5日均值" : "Similar 5D avg", formatPercent(calibration?.average_5d_return, true)],
        [language === "zh" ? "相似 1月均值" : "Similar 1M avg", formatPercent(calibration?.average_1m_return, true)],
        [language === "zh" ? "K线预测" : "K-line forecast", kline ? `${language === "zh" ? kline.label_zh : kline.label_en} · ${formatPercent(kline.forecast1d, true)}` : "—"],
        [language === "zh" ? "预测波动率" : "Forecast volatility", formatPercent(forecast.forecast_volatility_1m ?? null)],
        [language === "zh" ? "1个月预估区间" : "1M estimated range", expectedRange ? `${formatNumber(expectedRange.low)} – ${formatNumber(expectedRange.high)}` : "—"],
        [language === "zh" ? "优化来源" : "Optimizer source", optimization ? `${optimization.source}${optimization.ai_model ? ` · AI解释 ${optimization.ai_model}` : ""}` : "—"],
        [language === "zh" ? "优化权重漂移" : "Optimizer weight shift", optimization?.active ? formatPercent(optimization.applied_weight_shift ?? 0) : "—"],
        [t("completed"), String(stats?.completed ?? 0)],
        [t("directionAccuracy"), formatMetricPercent(stats?.direction_accuracy)],
        [t("majorityBaseline"), formatMetricPercent(stats?.majority_baseline_accuracy)],
        [language === "zh" ? "走步验证样本" : "Walk-forward samples", String(validation?.backtest.samples ?? 0)],
        [language === "zh" ? "走步方向优势" : "Walk-forward edge", formatMetricPercent(validation?.backtest.direction_edge, true)],
        [language === "zh" ? "真实冻结样本" : "Frozen live samples", String(validation?.live.samples ?? 0)],
      ]} />
      <div className="explanation">
        <h3>{t("explanation")}</h3>
        {explanation.map((line) => <p key={line}>{line}</p>)}
        {keyLevels && <p className="evidence-warning">{language === "zh" ? keyLevels.invalidation_zh : keyLevels.invalidation_en}</p>}
        <p className="range-note">{hasModelInterval ? (language === "zh" ? "区间由走步回测残差分位数校准；样本不足时回退到波动率区间。" : "The interval is calibrated from walk-forward residual quantiles, with a volatility fallback when samples are sparse.") : t("rangeNotice")}</p>
        <Link href="/methodology/">{language === "zh" ? "查看预测方法与限制" : "View method and limits"}</Link>
        <small>{t("updated")} {forecast.generated_at}</small>
      </div>
    </div>
    </details>
    {(scenarios.length || components.length) ? <details className="forecast-disclosure">
      <summary><span><strong>{language === "zh" ? "情景与子模型" : "Scenarios and submodels"}</strong><small>{language === "zh" ? "查看乐观、基准、悲观情景和组合权重" : "Bull, base and bear cases plus ensemble weights"}</small></span></summary>
    {scenarios.length ? <section className="forecast-scenarios">
      <h3>{language === "zh" ? "未来 1 个月情景" : "1-month scenarios"}</h3>
      <div>{scenarios.map((scenario) => <article key={scenario.name}><small>{language === "zh" ? scenario.label_zh : scenario.label_en} · {language === "zh" ? "情景权重" : "Scenario weight"} {scenario.probability}%</small><strong className={scenario.expected_return >= 0 ? "positive" : "negative"}>{formatPercent(scenario.expected_return, true)}</strong><span>{formatNumber(scenario.expected_price)}</span><p>{language === "zh" ? scenario.narrative_zh : scenario.narrative_en}</p></article>)}</div>
    </section> : null}
    {components.length ? <section className="model-components">
      <h3>{language === "zh" ? "子模型权重" : "Model components"}</h3>
      <div className="table-wrap"><table><thead><tr><th>{t("tableModel")}</th><th>{language === "zh" ? "权重" : "Weight"}</th><th>{t("nextDay")}</th><th>{t("next5d")}</th><th>{language === "zh" ? "未来1个月" : "Next month"}</th></tr></thead><tbody>{components.map((component) => <tr key={component.model}><td>{localizeModel(component.model, language)}</td><td>{formatPercent(component.weight)}</td><td>{formatPercent(component.forecast_1d_return, true)}</td><td>{formatPercent(component.forecast_5d_return, true)}</td><td>{formatPercent(component.forecast_1m_return ?? null, true)}</td></tr>)}</tbody></table></div>
    </section> : null}
    </details> : null}
    <AiAnalysisPanel asset={asset} forecast={forecast} history={history} validationSamples={stats?.completed ?? forecast.validation_sample_size} messages={aiMessages} summary={aiSummary} setMessages={setAiMessages} />
  </div>;
}

function ForecastContextPanel({ forecast }: { forecast: Forecast }) {
  const { language } = useApp();
  const zh = language === "zh";
  const context = forecast.contextual_inputs;
  if (!context) return null;
  const labels: Record<string, [string, string]> = {
    revenue_growth: ["收入增长", "Revenue growth"],
    income_growth: ["利润增长", "Profit growth"],
    valuation: ["估值", "Valuation"],
    news_headlines: ["新闻标题", "News headlines"],
    earnings_calendar: ["财报日历", "Earnings calendar"],
  };
  const adjustment = context.forecast_adjustment || {};
  const drivers = zh ? context.drivers_zh : context.drivers_en;
  return <section className={`forecast-context-panel ${context.earnings_risk ? "event-risk" : ""}`}>
    <header><span><strong>{zh ? "事件与基本面修正" : "Event and fundamental overlay"}</strong><small>{zh ? `模型权重上限 ${formatPercent(context.overlay_weight ?? 0.05)}` : `Model weight capped at ${formatPercent(context.overlay_weight ?? 0.05)}`}</small></span><b>{context.earnings_risk ? (zh ? "临近财报" : "Earnings soon") : (zh ? "无近期财报风险" : "No near-term earnings risk")}</b></header>
    <div className="forecast-context-metrics">
      <span><small>{zh ? "综合得分" : "Composite"}</small><strong>{formatSignedScore(context.score)}</strong></span>
      <span><small>{zh ? "基本面" : "Fundamentals"}</small><strong>{formatSignedScore(context.fundamental_score)}</strong></span>
      <span><small>{zh ? "新闻情绪" : "News sentiment"}</small><strong>{formatSignedScore(context.news_score)}</strong></span>
      <span><small>{zh ? "1个月贡献" : "1M contribution"}</small><strong className={Number(adjustment["1M"] || 0) >= 0 ? "positive" : "negative"}>{formatPercent(adjustment["1M"], true)}</strong></span>
    </div>
    <div className="forecast-context-inputs">{context.inputs.map((item) => <span key={item}>{labels[item]?.[zh ? 0 : 1] || item}</span>)}</div>
    {context.earnings_date ? <p>{zh ? `预计财报日期 ${context.earnings_date}${context.earnings_days === null || context.earnings_days === undefined ? "" : `，距今 ${context.earnings_days} 天`}；临近事件时该层会自动降权。` : `Estimated earnings date ${context.earnings_date}${context.earnings_days === null || context.earnings_days === undefined ? "" : `, ${context.earnings_days} days away`}; the overlay is reduced near the event.`}</p> : null}
    {drivers?.map((line) => <p key={line}>{line}</p>)}
  </section>;
}

function ForecastEvolution({ forecast, predictions, loading }: { forecast: Forecast; predictions?: PredictionHistory; loading?: boolean }) {
  const { language } = useApp();
  const zh = language === "zh";
  const records = (predictions?.live?.records || predictions?.records || []).slice(0, 8);
  if (loading && !predictions) return <section className="forecast-evolution"><header><strong>{zh ? "预测变化记录" : "Forecast change log"}</strong><small>{zh ? "正在读取冻结预测…" : "Loading frozen forecasts…"}</small></header></section>;
  const latest = records[0];
  const previous = records[1];
  const latestReturn = ledgerNumber(latest, "Forecast_1D_Return", forecast.forecast_1d_return);
  const previousReturn = ledgerNumber(previous, "Forecast_1D_Return", null);
  const delta = previousReturn === null || latestReturn === null ? null : latestReturn - previousReturn;
  return <section className="forecast-evolution">
    <header><span><strong>{zh ? "预测变化记录" : "Forecast change log"}</strong><small>{zh ? "仅使用当日冻结、事后不可回写的预测" : "Only immutable forecasts frozen on their publication date"}</small></span>{delta === null ? null : <b className={delta >= 0 ? "positive" : "negative"}>{zh ? "较上次" : "vs prior"} {formatPercent(delta, true)}</b>}</header>
    {records.length ? <div className="table-wrap"><table><thead><tr><th>{zh ? "日期" : "Date"}</th><th>{zh ? "模型" : "Model"}</th><th>1D</th><th>5D</th><th>10D</th><th>1M</th><th>{zh ? "实际1D" : "Actual 1D"}</th></tr></thead><tbody>{records.map((row, index) => <tr key={`${String(row.As_Of_Date)}-${index}`}><td>{String(row.As_Of_Date || "—")}</td><td>{localizeModel(String(row.Best_Model || forecast.best_model), language)}</td><td>{formatPercent(row.Forecast_1D_Return, true)}</td><td>{formatPercent(row.Forecast_5D_Return, true)}</td><td>{formatPercent(row.Forecast_10D_Return, true)}</td><td>{formatPercent(row.Forecast_1M_Return, true)}</td><td>{formatPercent(row.Actual_1D_Return, true)}</td></tr>)}</tbody></table></div> : <p>{zh ? "当前预测已生成；从下一次每日冻结预测开始，这里会保留方向、幅度和模型变化。" : "The current forecast is available. Direction, magnitude and model changes will appear after the next daily frozen call."}</p>}
  </section>;
}

function ledgerNumber(row: Record<string, number | string | boolean | null> | undefined, key: string, fallback: number | null): number | null {
  const value = row?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatSignedScore(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function AiAnalysisPanel({ asset, forecast, history, validationSamples, messages, summary, setMessages }: { asset: Asset; forecast: Forecast; history: History; validationSamples: number; messages: AiChatMessage[]; summary?: string; setMessages: (updater: AiChatMessage[] | ((current: AiChatMessage[]) => AiChatMessage[])) => void }) {
  const { language } = useApp();
  const zh = language === "zh";
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [streamText, setStreamText] = useState("");
  const [streamAnalysis, setStreamAnalysis] = useState<AiAnalysis | null>(null);
  const [lastPrompt, setLastPrompt] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const streamTextRef = useRef("");

  useEffect(() => {
    setError("");
    setDraft("");
    setStreamText("");
    setStreamAnalysis(null);
    abortRef.current?.abort();
  }, [asset.symbol, language]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  function clearStream() {
    setStreamText("");
    setStreamAnalysis(null);
    streamTextRef.current = "";
  }

  async function ask(question: string) {
    const trimmed = question.trim();
    if (loading) return;
    setLoading(true);
    setError("");
    setLastPrompt(trimmed);
    const controller = new AbortController();
    abortRef.current = controller;
    const conversation = conversationForApi({ messages, summary, updated_at: new Date().toISOString() });
    if (trimmed) trackEvent("ai_question");
    if (trimmed) setMessages((current) => {
      const last = current.at(-1);
      return last?.role === "user" && last.content.trim() === trimmed
        ? current
        : [...current, createChatMessage("user", trimmed)];
    });
    try {
      clearStream();
      const analysis = await streamAiAnalysis(asset.symbol, language, trimmed, conversation, (token) => {
        streamTextRef.current += token;
        setStreamText(streamTextRef.current);
      }, controller.signal);
      const content = aiAnalysisText(analysis, language, Boolean(trimmed));
      setStreamAnalysis(analysis);
      setMessages((current) => [...current, { ...createChatMessage("assistant", content), analysis }]);
      clearStream();
      setDraft("");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : (zh ? "AI 解读暂时不可用。" : "AI analysis is temporarily unavailable."));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
    const partial = streamTextRef.current.trim();
    const analysis = streamAnalysis;
    clearStream();
    if (partial) setMessages((current) => [...current, { ...createChatMessage("assistant", `${partial}${zh ? "\n\n（已停止生成）" : "\n\n(Generation stopped)"}`), analysis: analysis || undefined }]);
    setLoading(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loading) void ask(draft);
  }

  const lastQuestions = [...messages].reverse().find((message) => message.analysis)?.analysis?.questions || [];
  const starterQuestions = zh
    ? ["现在适合买入还是等回调？", "如果已经持有，止损位在哪？", "未来 5 日最大风险是什么？", "乐观和悲观情景分别是什么？", "和同类资产相比强不强？"]
    : ["Buy now or wait for a pullback?", "If I already hold it, where is the stop?", "What is the biggest 5-day risk?", "What are the bull and bear cases?", "Is it stronger than peers?"];
  const suggestions = lastQuestions.length ? lastQuestions : starterQuestions;

  return <section className="ai-analysis-panel">
    <header>
      <span><Sparkles size={16} /><strong>{zh ? "AI 预测对话" : "AI Forecast Chat"}</strong></span>
      <div className="ai-header-actions">
        {loading ? <button onClick={stop} className="secondary"><Square size={13} />{zh ? "停止生成" : "Stop"}</button> : messages.length ? <button onClick={() => ask(lastPrompt)} className="secondary"><RotateCcw size={13} />{zh ? "重新回答" : "Regenerate"}</button> : null}
        <button onClick={() => ask("")} disabled={loading}><Sparkles size={14} />{loading ? (zh ? "生成中" : "Generating") : messages.length ? (zh ? "刷新解读" : "Refresh read") : (zh ? "生成预测解读" : "Generate read")}</button>
      </div>
    </header>
    {error && <p className="ai-error" role="alert">{error}</p>}
    <div className="ai-chat-log" aria-live="polite" aria-busy={loading}>
      {messages.length ? messages.map((message) => <article key={message.id} className={`ai-chat-message ${message.role}`}>
        <strong>{message.role === "user" ? (zh ? "你" : "You") : "Orivane AI"}</strong>
        <p>{message.content}</p>
        {message.analysis && <AiDataTags analysis={message.analysis} dataAsOf={history.data_as_of} forecastModel={forecast.best_model} validationSamples={validationSamples} language={language} />}
      </article>) : !loading && <p className="notice">{zh ? "先生成一次解读，然后可以连续追问预测逻辑、风险、买卖时机和观察点。" : "Generate a read first, then keep asking about logic, risk, timing and watch items."}</p>}
      {loading && <article className="ai-chat-message assistant streaming"><strong>Orivane AI</strong><p>{streamText || (zh ? "正在读取行情、预测和验证数据…" : "Reading market, forecast and validation data…")}</p>{streamAnalysis && <AiDataTags analysis={streamAnalysis} dataAsOf={history.data_as_of} forecastModel={forecast.best_model} validationSamples={validationSamples} language={language} />}</article>}
    </div>
    <div className="ai-suggestions">{suggestions.slice(0, 5).map((item) => <button key={item} onClick={() => ask(item)} disabled={loading}>{item}</button>)}</div>
    <form className="ai-question-row" onSubmit={submit}>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={zh ? "继续追问，例如：现在更适合买入还是等待？" : "Ask a follow-up, e.g. buy now or wait?"} />
      <button type="submit" disabled={loading || !draft.trim()}>{zh ? "发送" : "Send"}</button>
    </form>
  </section>;
}

function AiDataTags({ analysis, dataAsOf, forecastModel, validationSamples, language }: { analysis: AiAnalysis; dataAsOf: string; forecastModel: string; validationSamples: number; language: "zh" | "en" }) {
  const zh = language === "zh";
  return <div className="ai-data-tags"><span><Database size={11} />{zh ? "行情" : "Market"} {dataAsOf}</span><span>{zh ? "预测模型" : "Forecast model"} {forecastModel}</span><span>{zh ? "验证样本" : "Validation"} {validationSamples}</span><small>{analysis.model} · {analysis.source === "structured_fallback" ? (zh ? "结构化备用" : "structured fallback") : "Gemini"}</small></div>;
}

function aiAnalysisText(analysis: AiAnalysis, language: "zh" | "en", followUp = false): string {
  if (followUp) return analysis.summary;
  const zh = language === "zh";
  const sections: [string, string[]][] = [
    [zh ? "预测解读" : "Forecast read", analysis.forecast_read],
    [zh ? "可信度说明" : "Confidence notes", analysis.confidence_notes],
    [zh ? "主要风险" : "Key risks", analysis.risks],
    [zh ? "后续观察" : "What to watch", analysis.watch_items],
  ];
  return [
    analysis.summary,
    ...sections
      .filter(([, items]) => items.length)
      .map(([title, items]) => `${title}：\n${items.map((item) => `• ${item}`).join("\n")}`),
  ].join("\n\n");
}

function PerformanceView({ performance }: { performance?: Performance }) {
  const { language, t } = useApp();
  if (!performance) return <EmptyState />;
  const best = performance.backtest.best;
  const live = performance.live_predictions.statistics.find((item) => item.window === "All");
  const models = performance.backtest.models || [];
  const horizons = (performance.backtest.horizon_statistics || []).filter((item) => item.window === "All");
  return <div className="performance-stack"><div className="performance-grid"><section><h3>{t("backtest")}</h3><MetricList items={[
    ["Price MAE", formatNumber(best.MAE, 4)], ["Price RMSE", formatNumber(best.RMSE, 4)], [language === "zh" ? "收益误差（百分点）" : "Return MAE (pp)", formatNumber(best.Return_MAE_Pct_Points, 2)],
    ["R²", formatNumber(best.R2, 3)], [t("directionAccuracy"), formatMetricPercent(best.Directional_Accuracy)], [t("majorityBaseline"), formatMetricPercent(best.Majority_Baseline_Accuracy)],
    [t("directionEdge"), formatMetricPercent(best.Directional_Edge, true)], [t("testSamples"), String(performance.backtest.test_samples)],
  ]} /></section><section><h3>{t("live")}</h3><MetricList items={[
    [t("completed"), String(live?.completed ?? 0)], [t("pending"), String(live?.pending ?? 0)], [t("directionAccuracy"), formatMetricPercent(live?.direction_accuracy)],
    [t("majorityBaseline"), formatMetricPercent(live?.majority_baseline_accuracy)], [t("directionEdge"), formatMetricPercent(live?.direction_edge, true)], [t("mae"), formatPercent(live?.mean_absolute_return_error)],
  ]} /><p className="notice">{t("historyNotice")}</p></section></div>
    {models.length > 1 ? <section className="model-comparison"><h3>{language === "zh" ? "模型对比" : "Model comparison"}</h3><div className="table-wrap"><table><thead><tr><th>{t("tableModel")}</th><th>{t("directionAccuracy")}</th><th>{t("majorityBaseline")}</th><th>{t("directionEdge")}</th><th>Return RMSE</th><th>{t("testSamples")}</th></tr></thead><tbody>{models.map((model) => <tr key={String(model.Model)}><td>{localizeModel(String(model.Model), language)}</td><td>{formatMetricPercent(model.Directional_Accuracy)}</td><td>{formatMetricPercent(model.Majority_Baseline_Accuracy)}</td><td>{formatMetricPercent(model.Directional_Edge, true)}</td><td>{formatPercent(model.Return_RMSE)}</td><td>{String(model.Samples ?? "—")}</td></tr>)}</tbody></table></div></section> : null}
    {horizons.length ? <section className="model-comparison"><h3>{language === "zh" ? "多周期验证" : "Multi-horizon validation"}</h3><div className="table-wrap"><table><thead><tr><th>{language === "zh" ? "周期" : "Horizon"}</th><th>{t("completed")}</th><th>{t("directionAccuracy")}</th><th>{t("majorityBaseline")}</th><th>{t("directionEdge")}</th><th>{t("mae")}</th></tr></thead><tbody>{horizons.map((item) => <tr key={String(item.horizon)}><td>{String(item.horizon)}</td><td>{item.completed}</td><td>{formatMetricPercent(item.direction_accuracy)}</td><td>{formatMetricPercent(item.majority_baseline_accuracy)}</td><td>{formatMetricPercent(item.direction_edge, true)}</td><td>{formatPercent(item.mean_absolute_return_error)}</td></tr>)}</tbody></table></div></section> : null}
  </div>;
}

function HistoryView({ predictions }: { predictions?: PredictionHistory }) {
  const { language, t } = useApp();
  const [source, setSource] = useState<"live" | "backtest" | "legacy">("live");
  if (!predictions) return <EmptyState />;
  const section = predictions[source] || { ...predictions, symbol: predictions.symbol };
  const data = section.charts.rolling_accuracy || [];
  const validation = section.records.filter((row) => row.Verified && typeof row.Actual_1D_Return === "number").slice(0, 40).reverse();
  const allStats = section.statistics.find((item) => item.window === "All");
  const labels = {
    live: language === "zh" ? "真实冻结预测" : "Frozen live predictions",
    backtest: language === "zh" ? "走步回测" : "Walk-forward backtest",
    legacy: language === "zh" ? "历史旧模型" : "Legacy models",
  };
  return <div className="history-layout">
    <div className="history-source-tabs" role="tablist" aria-label={language === "zh" ? "验证数据来源" : "Validation source"}>{(["live", "backtest", "legacy"] as const).map((item) => <button key={item} role="tab" aria-selected={source === item} className={source === item ? "active" : ""} onClick={() => setSource(item)}>{labels[item]}<small>{predictions[item]?.records.length ?? 0}</small></button>)}</div>
    <p className="notice">{source === "live" ? (language === "zh" ? "仅统计当时冻结、事后补齐真实结果的线上预测。" : "Only forecasts frozen at the time and later reconciled with actual outcomes are counted.") : source === "backtest" ? (language === "zh" ? "按时间顺序滚动训练和验证，不与真实线上样本混合。" : "Models are evaluated in chronological walk-forward order and are not mixed with live records.") : (language === "zh" ? "旧版模型记录单独保留，不纳入当前模型可信度。" : "Legacy model records are retained separately and do not determine current credibility.")}</p>
    <div className="history-stat-strip"><span><small>{t("completed")}</small><strong>{allStats?.completed ?? 0}</strong></span><span><small>{t("directionAccuracy")}</small><strong>{formatMetricPercent(allStats?.direction_accuracy)}</strong></span><span><small>{t("majorityBaseline")}</small><strong>{formatMetricPercent(allStats?.majority_baseline_accuracy)}</strong></span><span><small>{t("directionEdge")}</small><strong>{formatMetricPercent(allStats?.direction_edge, true)}</strong></span></div>
    {validation.length ? <section className="validation-chart"><h3>{t("forecastVsActual")}</h3><UnifiedLineChart height={220} rows={validation.map((row) => ({ ...row, Forecast_1D_Return: Number(row.Forecast_1D_Return) * 100, Actual_1D_Return: Number(row.Actual_1D_Return) * 100 }))} xKey="As_Of_Date" percent showLegend series={[{ key: "Forecast_1D_Return", name: t("tableForecast"), color: "#d08c2d" }, { key: "Actual_1D_Return", name: t("tableActual"), color: "#117a72" }]} /></section> : data.length ? <UnifiedLineChart height={220} rows={data} xKey="As_Of_Date" percent domain={[0, 100]} showLegend series={[{ key: "Rolling_Accuracy_20", name: language === "zh" ? "近 20 次准确率" : "Rolling accuracy", color: "#117a72" }, { key: "Cumulative_Accuracy", name: language === "zh" ? "累计准确率" : "Cumulative accuracy", color: "#d08c2d" }]} /> : <EmptyState message={language === "zh" ? "该来源暂时没有已完成验证的样本。" : "This source has no completed validation samples yet."} />}
    <div className="table-wrap"><table><thead><tr><th>{t("tableDate")}</th><th>{t("tableModel")}</th><th>1D {t("tableForecast")}</th><th>1D {t("tableActual")}</th><th>5D {t("tableActual")}</th><th>10D {t("tableActual")}</th><th>1M {t("tableActual")}</th><th>{t("tableHit")}</th></tr></thead><tbody>{section.records.slice(0, 20).map((row, index) => <tr key={`${row.As_Of_Date}-${row.Best_Model}-${index}`}><td>{String(row.As_Of_Date)}</td><td>{localizeModel(String(row.Best_Model), language)}</td><td>{formatPercent(row.Forecast_1D_Return, true)}</td><td>{formatPercent(row.Actual_1D_Return, true)}</td><td>{formatPercent(row.Actual_5D_Return, true)}</td><td>{formatPercent(row.Actual_10D_Return, true)}</td><td>{formatPercent(row.Actual_1M_Return, true)}</td><td>{row.Verified ? (Number(row.Raw_Direction_Correct) ? "✓" : "×") : "—"}</td></tr>)}</tbody></table></div>
  </div>;
}

function MetricList({ items }: { items: [string, string][] }) {
  return <dl className="metric-list">{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function forecastDrivers(forecast: Forecast, history: History, language: "zh" | "en"): string[] {
  const provided = language === "zh" ? forecast.drivers_zh : forecast.drivers_en;
  if (provided?.length) return provided;
  const latest = history.records.at(-1);
  const ma20 = Number(latest?.MA_20);
  const price = Number(latest?.Price);
  const macdHist = Number(latest?.MACD_Hist);
  const rsi = Number(latest?.RSI_14);
  const volatility = Number(history.snapshot.annualized_volatility_20d);
  const zh = language === "zh";
  return [
    zh ? `模型预计下一交易日收益 ${formatPercent(forecast.forecast_1d_return, true)}。` : `The model expects a next-session return of ${formatPercent(forecast.forecast_1d_return, true)}.`,
    Number.isFinite(price) && Number.isFinite(ma20) && ma20 !== 0
      ? zh ? `价格相对 20 日均线偏离 ${formatPercent(price / ma20 - 1, true)}。` : `Price is ${formatPercent(price / ma20 - 1, true)} away from the 20-day average.`
      : null,
    Number.isFinite(macdHist)
      ? zh ? `MACD 柱值${macdHist >= 0 ? "偏正" : "偏负"}，反映短线动能。` : `MACD histogram is ${macdHist >= 0 ? "positive" : "negative"}, reflecting short-term momentum.`
      : null,
    Number.isFinite(rsi)
      ? zh ? `RSI ${rsi.toFixed(1)}，${rsi > 70 ? "短线偏热" : rsi < 30 ? "短线偏冷" : "处于中性区间"}。` : `RSI is ${rsi.toFixed(1)}, ${rsi > 70 ? "short-term stretched" : rsi < 30 ? "short-term oversold" : "near neutral"}.`
      : null,
    Number.isFinite(volatility)
      ? zh ? `近 20 日年化波动率 ${formatPercent(volatility)}。` : `20-day annualized volatility is ${formatPercent(volatility)}.`
      : null,
  ].filter((item): item is string => Boolean(item));
}

function evidenceLevel(stale: boolean, unverified: boolean, completed: number, language: "zh" | "en") {
  if (stale) return {
    label: language === "zh" ? "需更新" : "Needs refresh",
    body: language === "zh" ? "预测会优先用当前行情重新计算，旧冻结结果只作为历史验证资料。" : "Current market data is preferred; old frozen outputs are kept as validation records.",
  };
  if (unverified) return {
    label: language === "zh" ? "待积累" : "Building",
    body: language === "zh" ? "历史行情已用于生成预测，真实滚动验证会随每日预测继续积累。" : "The forecast uses market history now; rolling live validation will accumulate daily.",
  };
  if (completed < 20) return {
    label: language === "zh" ? "中" : "Medium",
    body: language === "zh" ? "已有少量真实验证样本，但仍需继续积累。" : "Some live validation exists, but more samples are needed.",
  };
  return {
    label: language === "zh" ? "较高" : "Higher",
    body: language === "zh" ? "已有较多真实验证样本，可结合基准对比参考。" : "There are more verified samples, so benchmark comparison is more useful.",
  };
}

function personalizedDecisionAdvice(forecast: Forecast, history: History, score: number, profile: DecisionProfile, language: "zh" | "en") {
  const zh = language === "zh";
  const currentPrice = Number(history.snapshot.latest_price || forecast.base_price || 0);
  const expected = profile.horizon === "5D" ? Number(forecast.forecast_5d_return) : profile.horizon === "10D" ? Number(forecast.forecast_10d_return) : Number(forecast.forecast_1m_return);
  const invalidation = Number(forecast.key_levels?.invalidation);
  const support = Number(forecast.key_levels?.support);
  const breakout = Number(forecast.key_levels?.breakout || forecast.key_levels?.resistance);
  const entry = Number(profile.entry_price);
  const pnl = Number.isFinite(entry) && entry > 0 && currentPrice > 0 ? currentPrice / entry - 1 : null;
  const liveSamples = Number(forecast.validation?.live.samples ?? 0);
  const liveEdge = Number(forecast.validation?.live.direction_edge ?? 0);
  const validated = forecast.action?.actionable === true
    && score >= 55
    && Number(forecast.validation?.backtest.direction_edge ?? 0) > 0
    && (liveSamples < 20 || liveEdge > 0);
  const bullish = Number.isFinite(expected) && expected > 0;
  const level = (value: number) => Number.isFinite(value) && value > 0 ? formatNumber(value) : "—";
  const horizon = profile.horizon === "5D" ? (zh ? "未来 5 日" : "the next 5 days") : profile.horizon === "10D" ? (zh ? "未来 10 日" : "the next 10 days") : (zh ? "未来 1 个月" : "the next month");
  const riskAction = profile.risk === "conservative"
    ? (zh ? "先等待确认，单次风险敞口宜小" : "wait for confirmation and keep initial risk small")
    : profile.risk === "aggressive"
      ? (zh ? "可分批试仓，但必须预设失效退出条件" : "a staged probe is possible, but define an invalidation exit first")
      : (zh ? "分批执行，并用关键价位控制风险" : "stage the decision and control risk with key levels");

  if (profile.status === "holding") {
    const pnlText = pnl === null ? (zh ? "未填写成本" : "entry price not provided") : `${zh ? "当前相对成本" : "current return vs entry"} ${formatPercent(pnl, true)}`;
    if (bullish && validated) return {
      title: zh ? "持有观察，确认后再加仓" : "Hold; add only after confirmation",
      body: zh ? `${pnlText}。模型对${horizon}偏多；站稳突破位 ${level(breakout)} 后再考虑分批加仓，跌破失效位 ${level(invalidation)} 时优先减仓。` : `${pnlText}. The model is constructive for ${horizon}; consider staged adds only above ${level(breakout)}, and prioritize reducing risk below ${level(invalidation)}.`,
      guardrail: riskAction,
    };
    return {
      title: zh ? "优先保护仓位" : "Prioritize position protection",
      body: zh ? `${pnlText}。当前${horizon}预测${bullish ? "略偏多但验证不足" : "偏弱"}；反弹未突破 ${level(breakout)} 前不宜追加强度，跌破 ${level(invalidation)} 时考虑分批降低敞口。` : `${pnlText}. The ${horizon} view is ${bullish ? "slightly positive but weakly validated" : "soft"}; avoid adding before ${level(breakout)} and consider staged risk reduction below ${level(invalidation)}.`,
      guardrail: riskAction,
    };
  }
  if (bullish && validated) return {
    title: zh ? "等待确认后分批入场" : "Stage entry after confirmation",
    body: zh ? `模型对${horizon}偏多。可观察 ${level(support)} 附近承接，或放量突破 ${level(breakout)} 后分批入场；若随后跌破 ${level(invalidation)}，该判断失效。` : `The model is constructive for ${horizon}. Watch support near ${level(support)} or a confirmed break above ${level(breakout)} before staging an entry; the view fails below ${level(invalidation)}.`,
    guardrail: riskAction,
  };
  return {
    title: zh ? "继续等待，不追价" : "Wait; do not chase",
    body: zh ? `当前${horizon}预测${bullish ? "偏多但历史优势不足" : "偏弱"}。等待价格在 ${level(support)} 获得支撑或有效突破 ${level(breakout)}，再重新评估。` : `The ${horizon} view is ${bullish ? "positive but not well validated" : "soft"}. Reassess after support near ${level(support)} holds or price confirms above ${level(breakout)}.`,
    guardrail: riskAction,
  };
}

function tradingPosture(forecast: Forecast, score: number, language: "zh" | "en") {
  const oneDay = Number(forecast.forecast_1d_return || 0);
  const fiveDay = Number(forecast.forecast_5d_return || 0);
  const oneMonth = Number(forecast.forecast_1m_return ?? forecast.forecast_5d_return ?? 0);
  const weighted = oneDay * 0.25 + fiveDay * 0.35 + oneMonth * 0.4;
  const zh = language === "zh";
  if (forecast.action?.actionable !== true) return {
    title: weighted >= 0 ? (zh ? "数值偏多，仅作方向观察" : "Numeric upside bias, directional only") : (zh ? "数值偏空，仅作方向观察" : "Numeric downside bias, directional only"),
    label: zh ? "仅观察" : "Watch only",
    body: forecast.action ? (zh ? forecast.action.summary_zh : forecast.action.summary_en) : (zh ? "预测值可供观察，但当前结果尚未通过新版操作门槛。" : "The numeric forecast is available for observation, but it has not passed the current action threshold."),
    className: "observe",
  };
  if (weighted > 0.015 && score >= 58) return {
    title: zh ? "走势偏强，可关注进攻机会" : "Constructive trend, watch for entry setups",
    label: zh ? "偏进攻" : "Constructive",
    body: zh ? "预测收益为正且可信度尚可，适合观察回调后的分批机会。" : "Forecast return is positive with usable confidence; watch staged entries after pullbacks.",
    className: "positive",
  };
  if (weighted < -0.015 && score >= 58) return {
    title: zh ? "走势偏弱，优先控制风险" : "Weak trend, prioritize risk control",
    label: zh ? "偏防守" : "Defensive",
    body: zh ? "预测收益偏负，适合降低仓位冲动，等待趋势修复。" : "Forecast return is negative; avoid chasing and wait for trend repair.",
    className: "negative",
  };
  if (weighted > 0) return {
    title: zh ? "小幅偏多，等待确认" : "Slight upside bias, wait for confirmation",
    label: zh ? "轻度看多" : "Slightly bullish",
    body: zh ? "预测方向偏正，但强度一般，更适合结合支撑位和成交量确认。" : "Bias is positive but not strong; confirm with support and volume.",
    className: "observe",
  };
  return {
    title: zh ? "小幅偏空，先观察风险" : "Slight downside bias, watch risk first",
    label: zh ? "轻度看空" : "Slightly bearish",
    body: zh ? "预测方向偏负，但强度一般，适合先看风险释放。" : "Bias is negative but not strong; watch for risk to clear first.",
    className: "observe",
  };
}
