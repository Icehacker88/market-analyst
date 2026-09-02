"use client";

import { AppLink as Link } from "./app-link";
import { ArrowRight, CheckCircle2, FlaskConical, Gauge, RefreshCw, Sparkles, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getRecommendations } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import { assetPath } from "@/lib/asset-catalog";
import { displayAssetName } from "@/lib/assets";
import { formatNumber, formatPercent } from "@/lib/format";
import { localizeSignal } from "@/lib/i18n";
import type { RecommendationGroup, Recommendations, ScreenerRow } from "@/lib/types";
import { AssetLogo } from "./asset-logo";
import { useApp } from "./providers";
import { EmptyState, ErrorState, LoadingState } from "./states";

export function RecommendationsPage() {
  const { language } = useApp();
  const [data, setData] = useState<Recommendations | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState(language === "zh" ? "a_shares" : "us_stocks");
  const zh = language === "zh";
  const visibleGroups = useMemo(() => {
    if (!data) return [];
    return market === "all" ? data.groups : data.groups.filter((group) => group.id === market);
  }, [data, market]);
  const visibleRows = useMemo(() => visibleGroups.flatMap((group) => group.rows), [visibleGroups]);
  const validatedRows = useMemo(() => visibleRows.filter((row) => row.action?.actionable === true), [visibleRows]);
  const candidateGroups = useMemo(() => visibleGroups.map((group) => ({
    ...group,
    rows: group.rows.filter((row) => row.action?.actionable !== true),
  })), [visibleGroups]);

  function load() {
    setLoading(true);
    setError(null);
    getRecommendations()
      .then(setData)
      .catch(() => {
        setData(null);
        setError(zh ? "推荐数据暂时不可用。" : "Recommendations are temporarily unavailable.");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  return (
    <main className="page-shell recommendations-page">
      <header className="page-title">
        <div>
          <h1>{zh ? "研究候选与已验证结论" : "Research candidates and validated calls"}</h1>
          <p>{zh ? "研究候选用于发现资产；只有通过新鲜度、独立验证样本和正基准优势门槛的预测才进入已验证区。" : "Candidates support discovery; only current forecasts with sufficient independent samples and positive benchmark edge enter the validated section."}</p>
        </div>
        <button className="primary-link" onClick={load} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={15} />{zh ? "刷新" : "Refresh"}</button>
      </header>

      {loading ? <LoadingState /> : error ? <ErrorState message={error} retry={load} /> : (
        <div className="recommendation-sections">
          {data && <nav className="recommendation-market-tabs" aria-label={zh ? "推荐市场" : "Recommendation market"}>
            <button className={market === "all" ? "active" : ""} onClick={() => setMarket("all")}>{zh ? "全部" : "All"}<small>{data.groups.reduce((total, group) => total + group.rows.length, 0)}</small></button>
            {data.groups.map((group) => <button key={group.id} className={market === group.id ? "active" : ""} onClick={() => setMarket(group.id)}>{marketLabel(group.id, zh)}<small>{group.rows.length}</small></button>)}
          </nav>}
          <section className="recommendation-validation-summary">
            <article><CheckCircle2 size={17} /><span><small>{zh ? "已通过模型验证" : "Validated by model evidence"}</small><strong>{validatedRows.length}</strong></span></article>
            <article><FlaskConical size={17} /><span><small>{zh ? "趋势研究候选" : "Trend research candidates"}</small><strong>{visibleRows.length - validatedRows.length}</strong></span></article>
            <p>{validatedRows.length ? (zh ? "以下资产已通过当前模型门槛，仍需结合风险和失效位判断。" : "The validated assets below pass current model gates; risk and invalidation still matter.") : (zh ? "当前市场没有预测同时通过全部验证门槛，因此不提供买卖结论；下方仅展示研究候选。" : "No forecast currently passes every validation gate, so no buy/sell conclusion is shown; the assets below are research candidates only.")}<Link href="/track-record/">{zh ? "查看完整验证成绩" : "View full validation record"}<ArrowRight size={13} /></Link></p>
          </section>
          {validatedRows.length > 0 && <section className="recommendation-section validated-recommendations">
            <header><span><CheckCircle2 size={15} /><strong>{zh ? "已通过模型验证" : "Validated model calls"}</strong><small>{zh ? "预测新鲜、样本充分且相对基准优势为正" : "Current, sufficiently sampled and above the benchmark"}</small></span><small>{data?.data_as_of}</small></header>
            <div className="recommendation-card-grid">{validatedRows.map((row) => <RecommendationCard key={row.symbol} row={row} language={language} />)}</div>
          </section>}
          {visibleGroups.length > 0 && <RecommendationHighlights groups={visibleGroups} language={language} />}
          {visibleGroups.length > 0 && <PredictionOpportunityHighlights groups={visibleGroups} language={language} />}
          {candidateGroups.map((group) => <RecommendationSection key={group.id} group={group} zh={zh} language={language} />)}
        </div>
      )}
    </main>
  );
}

function marketLabel(id: string, zh: boolean): string {
  if (id === "a_shares") return zh ? "A 股" : "A shares";
  if (id === "hk_stocks") return zh ? "港股" : "Hong Kong";
  return zh ? "美股" : "US stocks";
}

function RecommendationSection({ group, zh, language }: { group: RecommendationGroup; zh: boolean; language: "zh" | "en" }) {
  const title = zh ? group.title_zh : group.title_en;
  return (
    <section className="recommendation-section">
      <header>
        <span><FlaskConical size={15} /><strong>{title} · {zh ? "研究候选" : "research candidates"}</strong><small>{zh ? group.summary_zh : group.summary_en}</small></span>
        {group.data_as_of ? <small>{zh ? "数据截至" : "Data as of"} {group.data_as_of}</small> : null}
      </header>
      {group.rows.length ? (
        <div className="recommendation-card-grid">
          {group.rows.map((row) => <RecommendationCard key={row.symbol} row={row} language={language} />)}
        </div>
      ) : <EmptyState message={zh ? "该市场暂无未验证的研究候选。" : "There are no unvalidated research candidates in this market."} />}
    </section>
  );
}

function RecommendationCard({ row, language }: { row: ScreenerRow; language: "zh" | "en" }) {
  const zh = language === "zh";
  const validated = row.action?.actionable === true;
  const reason = zh ? row.recommendation_reason_zh : row.recommendation_reason_en;
  const risk = zh ? row.recommendation_risk_zh : row.recommendation_risk_en;
  const style = zh ? row.recommendation_style_zh : row.recommendation_style_en;
  const horizon = zh ? row.recommendation_horizon_zh : row.recommendation_horizon_en;
  const tags = zh ? row.recommendation_tags_zh : row.recommendation_tags_en;
  return (
    <Link className={`recommendation-card ${validated ? "validated" : "candidate"}`} href={assetPath(row.symbol)} onClick={() => trackEvent("recommendation_open")}>
      <header>
        <AssetLogo asset={row} />
        <span>
          <strong>{displayAssetName(row, language) || row.symbol}</strong>
          <small>{row.symbol}</small>
        </span>
        <b className="recommendation-score" title={zh ? "研究候选综合分" : "Research candidate score"}>{row.recommendation_score ?? "—"}</b>
      </header>
      <span className={`recommendation-evidence-badge ${validated ? "validated" : "candidate"}`}>{validated ? <CheckCircle2 size={12} /> : <FlaskConical size={12} />}{validated ? (zh ? "已通过模型验证" : "Validated") : (zh ? "研究候选，非交易结论" : "Research candidate, not a trade call")}</span>
      <div className="recommendation-price">
        <b>{formatNumber(row.latest_price)}</b>
        <em className={(row.return_1d ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(row.return_1d, true)}</em>
      </div>
      {reason && <p><small>{zh ? "入选依据" : "Selection rationale"}</small>{reason}</p>}
      <div className="recommendation-meta">
        {style && <span><small>{zh ? "类型" : "Style"}</small><b>{style}</b></span>}
        {horizon && <span><small>{zh ? "周期" : "Horizon"}</small><b>{horizon}</b></span>}
        <span><small>{zh ? "1日研究值" : "1D research value"}</small><b className={(row.forecast_1d_return ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(row.forecast_1d_return, true)}</b></span>
        <span><small>{zh ? "1月研究值" : "1M research value"}</small><b className={(row.forecast_1m_return ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(row.forecast_1m_return, true)}</b></span>
      </div>
      <div className="recommendation-tags">
        {risk && <span><Gauge size={12} />{risk}</span>}
        {(tags || []).slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <dl>
        <div><dt>3M</dt><dd className={(row.return_3m ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(row.return_3m, true)}</dd></div>
        <div><dt>1Y</dt><dd className={(row.return_1y ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(row.return_1y, true)}</dd></div>
        <div><dt>{zh ? "预测状态" : "Forecast status"}</dt><dd>{zh ? row.action?.label_zh || localizeSignal(row.signal, language) : row.action?.label_en || localizeSignal(row.signal, language)}</dd></div>
      </dl>
      <span className="recommendation-open">{zh ? "查看详情" : "View details"}<ArrowRight size={14} /></span>
    </Link>
  );
}

function PredictionOpportunityHighlights({ groups, language }: { groups: RecommendationGroup[]; language: "zh" | "en" }) {
  const zh = language === "zh";
  const rows = groups.flatMap((group) => group.rows).filter((row) => row.action?.actionable === true);
  const strongestBullish = [...rows].filter((row) => Number(row.forecast_1m_return ?? 0) > 0).sort((a, b) => Number(b.forecast_1m_return ?? 0) - Number(a.forecast_1m_return ?? 0))[0];
  const strongestBearish = [...rows].filter((row) => Number(row.forecast_1m_return ?? 0) < 0).sort((a, b) => Number(a.forecast_1m_return ?? 0) - Number(b.forecast_1m_return ?? 0))[0];
  const highestConfidence = [...rows].filter((row) => typeof row.prediction_confidence_score === "number").sort((a, b) => Number(b.prediction_confidence_score) - Number(a.prediction_confidence_score))[0];
  const largestForecastMove = [...rows].filter((row) => typeof row.forecast_1d_return === "number").sort((a, b) => Math.abs(Number(b.forecast_1d_return)) - Math.abs(Number(a.forecast_1d_return)))[0];
  const highestRisk = [...rows].filter((row) => typeof row.volatility_20d === "number").sort((a, b) => Number(b.volatility_20d) - Number(a.volatility_20d))[0];
  const items = [
    { title: zh ? "1个月最强预测" : "Strongest 1M forecast", row: strongestBullish, value: (row: ScreenerRow) => formatPercent(row.forecast_1m_return, true) },
    { title: zh ? "1个月转弱预警" : "Weakest 1M forecast", row: strongestBearish, value: (row: ScreenerRow) => formatPercent(row.forecast_1m_return, true) },
    { title: zh ? "最高可信度" : "Highest confidence", row: highestConfidence, value: (row: ScreenerRow) => `${row.prediction_confidence_score ?? "—"}/100` },
    { title: zh ? "预测波动最大" : "Largest forecast move", row: largestForecastMove, value: (row: ScreenerRow) => formatPercent(row.forecast_1d_return, true) },
    { title: zh ? "高波动风险" : "High-volatility risk", row: highestRisk, value: (row: ScreenerRow) => formatPercent(row.volatility_20d) },
  ].filter((item) => item.row);
  if (!items.length) return <section className="recommendation-highlights prediction-opportunities empty"><header><strong>{zh ? "已验证预测榜" : "Validated forecast board"}</strong><small>{zh ? "当前核心样本尚无预测同时通过新鲜度、正优势和校准门槛。" : "No core-sample forecast currently passes freshness, positive-edge and calibration thresholds together."}</small></header></section>;
  return <section className="recommendation-highlights prediction-opportunities"><header><strong>{zh ? "已验证预测榜" : "Validated forecast board"}</strong><small>{zh ? "仅包含通过全部模型门槛的资产" : "Only assets passing every model gate"}</small></header><div>{items.map((item) => {
    const row = item.row!;
    return <Link key={item.title} href={assetPath(row.symbol)}><span><Sparkles size={14} /><strong>{item.title}</strong></span><b>{displayAssetName(row, language) || row.symbol}</b><small>{row.symbol} · {item.value(row)}</small></Link>;
  })}</div></section>;
}

function RecommendationHighlights({ groups, language }: { groups: RecommendationGroup[]; language: "zh" | "en" }) {
  const zh = language === "zh";
  const rows = groups.flatMap((group) => group.rows);
  const highlights = [
    {
      title: zh ? "涨势最强" : "Strongest trend",
      icon: <TrendingUp size={14} />,
      row: [...rows].filter((row) => typeof row.return_1y === "number").sort((a, b) => Number(b.return_1y) - Number(a.return_1y))[0],
      value: (row: ScreenerRow) => formatPercent(row.return_1y, true),
    },
    {
      title: zh ? "稳健低波动" : "Lower volatility",
      icon: <Gauge size={14} />,
      row: [...rows].filter((row) => typeof row.volatility_20d === "number" && (row.return_1y ?? 0) > 0).sort((a, b) => Number(a.volatility_20d) - Number(b.volatility_20d))[0],
      value: (row: ScreenerRow) => formatPercent(row.volatility_20d),
    },
    {
      title: zh ? "模型看涨" : "Bullish model",
      icon: <Sparkles size={14} />,
      row: [...rows].filter((row) => row.signal === "Up" && row.action?.actionable === true).sort((a, b) => Number(b.recommendation_score ?? 0) - Number(a.recommendation_score ?? 0))[0],
      value: (row: ScreenerRow) => `${row.recommendation_score ?? "—"}`,
    },
    {
      title: zh ? "估值观察" : "Value watch",
      icon: <Gauge size={14} />,
      row: [...rows].filter((row) => typeof row.pe_ratio === "number" && row.pe_ratio > 0 && row.pe_ratio < 40).sort((a, b) => Number(b.recommendation_score ?? 0) - Number(a.recommendation_score ?? 0))[0],
      value: (row: ScreenerRow) => `PE ${formatNumber(row.pe_ratio)}`,
    },
  ].filter((item) => item.row);
  if (!highlights.length) return null;
  return <section className="recommendation-highlights"><header><strong>{zh ? "研究发现榜" : "Research discovery lists"}</strong><small>{zh ? "按行情和基本属性筛选，不代表模型已验证" : "Screened by market and descriptive data; model validation is separate"}</small></header><div>{highlights.map((item) => {
    const row = item.row!;
    return <Link key={item.title} href={assetPath(row.symbol)}><span>{item.icon}<strong>{item.title}</strong></span><b>{displayAssetName(row, language) || row.symbol}</b><small>{row.symbol} · {item.value(row)}</small></Link>;
  })}</div></section>;
}
