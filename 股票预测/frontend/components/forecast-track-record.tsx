"use client";

import { BrainCircuit, Download, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { getForecastScoreboard } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import { forecastTrend, type ForecastTrend } from "@/lib/forecast-trend";
import { accuracyWithInterval, edgeClass, eligibilityCounts, gateSummary, QUALIFIED_SAMPLE_GOAL, qualifiedStats, reasonBreakdown, reasonLabel, recordState, stateLabel, stateReasonCode } from "@/lib/forecast-eligibility-view";
import { formatMetricPercent } from "@/lib/format";
import { localizeModel } from "@/lib/i18n";
import type { ForecastScoreAsset, ForecastScoreboard, LedgerRecord, LedgerStat } from "@/lib/types";
import { useApp } from "./providers";
import { EmptyState, Skeleton } from "./states";

function all(stats: LedgerStat[]): LedgerStat | undefined {
  return stats.find((item) => item.window === "All" && (!item.horizon || item.horizon === "1D"));
}

function horizonStat(stats: LedgerStat[], horizon: string): LedgerStat | undefined {
  return stats.find((item) => item.window === "All" && item.horizon === horizon);
}

function statusLabel(status: ForecastScoreAsset["governance"] extends infer T ? string : never, zh: boolean): string {
  return ({ warming_up: zh ? "合格样本积累中" : "Qualified samples accumulating", stable: zh ? "稳定" : "Stable", watch: zh ? "观察" : "Watch", rollback: zh ? "已回滚" : "Rolled back" } as Record<string, string>)[status] || status;
}

function trendLabel(trend: ForecastTrend, zh: boolean): string {
  if (trend.state === "improving") return zh ? "近期改善" : "Improving";
  if (trend.state === "worsening") return zh ? "近期恶化" : "Deteriorating";
  if (trend.state === "stable") return zh ? "近期稳定" : "Stable";
  return zh ? "等待完整窗口" : "Awaiting full window";
}

export function ForecastTrackRecord() {
  const { language } = useApp();
  const zh = language === "zh";
  const [data, setData] = useState<ForecastScoreboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [market, setMarket] = useState("all");
  const [horizon, setHorizon] = useState("1D");
  const [model, setModel] = useState("all");
  const load = () => {
    setLoading(true);
    getForecastScoreboard().then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  };
  useEffect(() => {
    trackEvent("track_record_view");
    load();
  }, []);
  if (loading) return <main className="page-shell score-page"><Skeleton rows={6} /></main>;
  if (!data) return <main className="page-shell score-page"><EmptyState message={zh ? "预测成绩暂时不可用。" : "Forecast record is temporarily unavailable."} /></main>;
  const backtest = all(data.backtest.statistics);
  // Live statistics without the timing protocol (e.g. an old cached response) are not evidence.
  const liveStats = qualifiedStats(data.live.statistics);
  const live = all(liveStats);
  const liveKnown = Boolean(live);
  const backtestEdge = Number(backtest?.direction_edge);
  const liveEdge = typeof live?.direction_edge === "number" && Number.isFinite(live.direction_edge) ? live.direction_edge : null;
  const liveSamples = live?.completed ?? 0;
  const liveCounts = eligibilityCounts(live);
  const backtestTrend = forecastTrend(data.backtest.statistics);
  const liveTrend = forecastTrend(liveStats);
  // Judged per asset from each governance evidence gate, never from the cross-asset total.
  const gates = gateSummary(data.per_asset.map((asset) => ({ symbol: asset.symbol, gate: asset.governance?.evidence_gate })));
  const overallState = backtestEdge > 0 && gates.allMet
    ? "validated"
    : (Number.isFinite(backtestEdge) && backtestEdge <= 0) || gates.anyNotMet
      ? "below_baseline"
      : !liveKnown || !gates.known
        ? "unconfirmed"
        : "building";
  const stateCopy = overallState === "validated"
    ? {
      title: zh ? "各核心资产均已达到既定证据门槛" : "Every core asset meets the evidence gate",
      body: zh ? `每个资产当前预测政策版本至少 ${QUALIFIED_SAMPLE_GOAL} 个合格样本，且准确率 95% 区间下限高于简单基准。这是保守的使用门槛，不是统计显著性结论，也不代表未来一定有效。` : `Each asset has at least ${QUALIFIED_SAMPLE_GOAL} qualified samples under the current forecast policy, with the 95% lower bound of accuracy above the simple baseline. This is a conservative usage gate, not a significance result, and does not guarantee future performance.`,
    }
    : overallState === "below_baseline"
      ? {
        title: zh ? "当前模型尚未证明优于简单基准" : "Current model has not yet beaten the simple baseline",
        body: zh ? "所有推荐保持“研究候选”状态，不形成买卖结论。模型会继续积累冻结样本并接受自动回滚治理。" : "All picks remain research candidates rather than trade conclusions while frozen evidence accumulates under rollback governance.",
      }
      : overallState === "unconfirmed"
        ? {
          title: zh ? "实盘成绩暂不可判定" : "Live results cannot be assessed yet",
          body: zh ? "实盘统计缺少时间资格口径或关键指标（可能来自旧版缓存），刷新后再查看；确认之前不作为验证依据。" : "Live statistics lack the timing protocol or a key metric (possibly an old cached response). Refresh to retry; they are not used as validation evidence until confirmed.",
        }
      : {
        title: zh ? `实盘证据积累中（${gates.progress}）` : `Live evidence accumulating (${gates.progress})`,
        body: zh ? "样本不足时只展示数值研究结果，不将历史同向占比解释为未来真实概率；在此期间模型使用保守组合。" : "Until enough qualified samples exist, numeric research outputs are shown without presenting historical direction share as a future probability, and the model runs its conservative ensemble.",
      };
  const publicRecords = data.recent_live_records || [];
  const models = [...new Set(publicRecords.map((row) => String(row.Best_Model || "—")))].sort();
  const filteredRecords = publicRecords.filter((row) => {
    const symbol = String(row.Symbol || "");
    if (market !== "all" && recordMarket(symbol) !== market) return false;
    if (model !== "all" && String(row.Best_Model || "—") !== model) return false;
    return true;
  });
  const horizons = ["1D", "5D", "10D", "1M"].map((horizon) => ({
    horizon,
    backtest: horizonStat(data.backtest.horizon_statistics, horizon),
    live: horizonStat(qualifiedStats(data.live.horizon_statistics), horizon),
  }));
  return <main className="page-shell score-page">
    <header className="page-title"><div><h1>{zh ? "预测成绩与模型治理" : "Forecast record and model governance"}</h1><p>{zh ? "回测与真实冻结预测分开披露；模型漂移时自动暂停晋级并回退。" : "Backtests and frozen live calls are reported separately; drift automatically blocks promotion and triggers rollback."}</p></div><div className="score-page-actions"><button className="icon-button labeled" onClick={load}><RefreshCw size={14} />{zh ? "刷新" : "Refresh"}</button><button className="icon-button labeled" disabled={!filteredRecords.length} onClick={() => downloadForecastCsv(filteredRecords, horizon, zh)}><Download size={14} />CSV</button></div></header>
    <section className={`score-status-banner ${overallState}`}>
      <ShieldCheck size={20} />
      <span><strong>{stateCopy.title}</strong><p>{stateCopy.body}</p></span>
      <small>{zh ? `数据截至 ${data.data_as_of || "—"}` : `Data as of ${data.data_as_of || "—"}`}</small>
    </section>
    <p className="score-note score-protocol-note">{zh
      ? "实盘成绩只统计通过时间资格的冻结预测：基准日收盘后生成、目标交易日开盘前冻结，并按不复权收盘价结算。收益为不含分红的价格收益，与复权回测口径不同。旧记录缺少冻结证据，保留展示但不计分。"
      : "Live results count only time-qualified frozen forecasts: generated after the base close, frozen before the target session opens, and settled on unadjusted closes. Returns are price returns excluding dividends, so they differ from the adjusted backtest. Legacy records lack freeze evidence; they stay visible but are not scored."}</p>
    <section className="score-summary">
      <article><small>{zh ? "走步回测样本" : "Walk-forward samples"}</small><strong>{backtest?.completed ?? 0}</strong><span>{zh ? "时间顺序验证" : "Chronological validation"}</span></article>
      <article><small>{zh ? "回测方向优势" : "Backtest edge"}</small><strong className={edgeClass(backtest?.direction_edge)}>{formatMetricPercent(backtest?.direction_edge, true)}</strong><span>{zh ? `准确率 ${formatMetricPercent(backtest?.direction_accuracy)}` : `Accuracy ${formatMetricPercent(backtest?.direction_accuracy)}`}</span></article>
      <article><small>{zh ? "合格实盘样本" : "Qualified live samples"}</small><strong>{liveKnown ? liveSamples : "—"}</strong><span>{!liveKnown ? (zh ? "统计口径未确认" : "Scoring protocol unconfirmed") : liveCounts.excluded ? (zh ? `另有 ${liveCounts.excluded} 条已有结果但不计入` : `${liveCounts.excluded} more have outcomes but do not count`) : (zh ? "发布后不可回写" : "Immutable after publication")}</span></article>
      <article><small>{zh ? "实盘方向优势" : "Live direction edge"}</small><strong className={edgeClass(live?.direction_edge)}>{formatMetricPercent(live?.direction_edge, true)}</strong><span>{zh ? `多数类基准 ${formatMetricPercent(live?.majority_baseline_accuracy)}` : `Majority baseline ${formatMetricPercent(live?.majority_baseline_accuracy)}`}</span></article>
    </section>
    <section className="score-trend" aria-label={zh ? "近期模型趋势" : "Recent model trend"}>
      {[
        { key: "backtest", title: zh ? "近 20 期回测" : "Latest 20 backtests", trend: backtestTrend },
        { key: "live", title: zh ? "近 20 期合格实盘预测" : "Latest 20 qualified live calls", trend: liveTrend },
      ].map(({ key, title, trend }) => <article key={key}>
        <span><small>{title}</small><strong className={edgeClass(trend.recent?.direction_edge)}>{formatMetricPercent(trend.recent?.direction_edge, true)}</strong></span>
        <b className={trend.state === "improving" ? "positive" : trend.state === "worsening" ? "negative" : ""}>{trendLabel(trend, zh)}</b>
        <p>{trend.delta === null
          ? (zh ? `${key === "live" ? "合格样本" : "已完成"} ${trend.recent?.completed ?? 0}/20 个，完整窗口后才判断改善或恶化。` : `${trend.recent?.completed ?? 0}/20 ${key === "live" ? "qualified " : ""}samples complete; trend is judged only after a full window.`)
          : (zh ? `较全部样本${trend.delta >= 0 ? "高" : "低"} ${formatMetricPercent(Math.abs(trend.delta))}。短期变化不替代完整样本结论。` : `${formatMetricPercent(Math.abs(trend.delta))} ${trend.delta >= 0 ? "above" : "below"} the full-sample edge. Short-term change does not replace the full record.`)}</p>
      </article>)}
    </section>
    <section className="score-horizons">
      <header><h2>{zh ? "多周期验证凭证" : "Multi-horizon validation passport"}</h2><small>{zh ? "准确率必须与同期多数类基准比较" : "Accuracy must be compared with the contemporaneous majority baseline"}</small></header>
      <div className="table-wrap"><table className="mobile-card-table"><thead><tr><th>{zh ? "周期" : "Horizon"}</th><th>{zh ? "回测样本" : "Backtest samples"}</th><th>{zh ? "回测准确率" : "Backtest accuracy"}</th><th>{zh ? "回测基准" : "Backtest baseline"}</th><th>{zh ? "回测优势" : "Backtest edge"}</th><th>{zh ? "合格样本" : "Qualified samples"}</th><th>{zh ? "实盘准确率" : "Live accuracy"}</th><th>{zh ? "实盘优势" : "Live edge"}</th><th>{zh ? "结论" : "Conclusion"}</th></tr></thead><tbody>{horizons.map(({ horizon, backtest: horizonBacktest, live: horizonLive }) => {
        const edge = Number(horizonBacktest?.direction_edge);
        const hasEdge = typeof horizonBacktest?.direction_edge === "number" && Number.isFinite(edge);
        const samples = horizonBacktest?.completed ?? 0;
        const liveCount = horizonLive?.completed ?? 0;
        const state = samples < 20 || !hasEdge ? "building" : edge <= 0 ? "negative_edge" : liveCount < 20 ? "provisional" : Number(horizonLive?.direction_edge) > 0 ? "validated" : "negative_edge";
        const label = state === "validated" ? (zh ? "已验证" : "Validated") : state === "provisional" ? (zh ? "等待合格样本" : "Awaiting qualified samples") : state === "negative_edge" ? (zh ? "未优于基准" : "Below baseline") : (zh ? "样本积累中" : "Building evidence");
        return <tr key={horizon}>
          <td data-label={zh ? "周期" : "Horizon"}><strong>{horizon}</strong></td>
          <td data-label={zh ? "回测样本" : "Backtest samples"}>{samples}</td>
          <td data-label={zh ? "回测准确率" : "Backtest accuracy"}>{formatMetricPercent(horizonBacktest?.direction_accuracy)}</td>
          <td data-label={zh ? "回测基准" : "Backtest baseline"}>{formatMetricPercent(horizonBacktest?.majority_baseline_accuracy)}</td>
          <td data-label={zh ? "回测优势" : "Backtest edge"} className={edgeClass(horizonBacktest?.direction_edge)}>{formatMetricPercent(horizonBacktest?.direction_edge, true)}</td>
          <td data-label={zh ? "合格样本" : "Qualified samples"}>{horizonLive ? liveCount : "—"}</td>
          <td data-label={zh ? "实盘准确率" : "Live accuracy"}>{formatMetricPercent(horizonLive?.direction_accuracy)}</td>
          <td data-label={zh ? "实盘优势" : "Live edge"} className={edgeClass(horizonLive?.direction_edge)}>{formatMetricPercent(horizonLive?.direction_edge, true)}</td>
          <td data-label={zh ? "结论" : "Conclusion"}><span className={`forecast-passport-status ${state}`}>{label}</span></td>
        </tr>;
      })}</tbody></table></div>
    </section>
    <section className="score-horizons score-eligibility" aria-labelledby="score-eligibility-title">
      <header><h2 id="score-eligibility-title">{zh ? "实盘样本资格" : "Live sample eligibility"}</h2><small>{zh ? "每条冻结预测按周期判定；不计入的记录不会被隐藏" : "Each frozen forecast is judged per horizon; excluded records are not hidden"}</small></header>
      <div className="table-wrap"><table className="mobile-card-table"><thead><tr><th>{zh ? "周期" : "Horizon"}</th><th>{zh ? "已有结果" : "With outcome"}</th><th>{zh ? "已计入" : "Counted"}</th><th>{zh ? "有结果但不计入" : "Outcome, not counted"}</th><th>{zh ? "时间合格" : "Timing eligible"}</th><th>{zh ? "时间不合格" : "Timing ineligible"}</th><th>{zh ? "资格未确认" : "Unconfirmed"}</th><th>{zh ? "近期记录主要原因" : "Main reasons in recent records"}</th></tr></thead><tbody>{horizons.map(({ horizon: label, live: horizonLive }) => {
        const counts = eligibilityCounts(horizonLive);
        const shown = (value: number | null) => value === null ? "—" : String(value);
        const reasons = reasonBreakdown(publicRecords, label);
        return <tr key={label}>
          <td data-label={zh ? "周期" : "Horizon"}><strong>{label}</strong></td>
          <td data-label={zh ? "已有结果" : "With outcome"}>{shown(counts.observed)}</td>
          <td data-label={zh ? "已计入" : "Counted"}>{horizonLive ? horizonLive.completed : "—"}</td>
          <td data-label={zh ? "有结果但不计入" : "Outcome, not counted"}>{shown(counts.excluded)}</td>
          <td data-label={zh ? "时间合格" : "Timing eligible"}>{shown(counts.eligible)}</td>
          <td data-label={zh ? "时间不合格" : "Timing ineligible"}>{shown(counts.ineligible)}</td>
          <td data-label={zh ? "资格未确认" : "Unconfirmed"}>{shown(counts.unknown)}</td>
          <td data-label={zh ? "近期记录主要原因" : "Main reasons in recent records"}>{reasons.length ? reasons.map((item) => `${reasonLabel(item.code, zh)}（${item.count}）`).join(zh ? "；" : "; ") : "—"}</td>
        </tr>;
      })}</tbody></table></div>
    </section>
    <section className="score-public-records">
      <header><span><h2>{zh ? "公开冻结预测记录" : "Public frozen forecast record"}</h2><small>{zh ? `监控 ${data.monitored_symbols?.length || 0} 个代表性资产；发布后不可回写` : `${data.monitored_symbols?.length || 0} representative assets monitored; records are immutable after publication`}</small></span><div><label><span className="sr-only">{zh ? "市场" : "Market"}</span><select value={market} onChange={(event) => setMarket(event.target.value)}><option value="all">{zh ? "全部市场" : "All markets"}</option><option value="us">{zh ? "美股" : "US"}</option><option value="a">A 股</option><option value="hk">{zh ? "港股" : "Hong Kong"}</option></select></label><label><span className="sr-only">{zh ? "周期" : "Horizon"}</span><select value={horizon} onChange={(event) => setHorizon(event.target.value)}>{["1D", "5D", "10D", "1M"].map((item) => <option key={item}>{item}</option>)}</select></label><label><span className="sr-only">{zh ? "模型" : "Model"}</span><select value={model} onChange={(event) => setModel(event.target.value)}><option value="all">{zh ? "全部模型" : "All models"}</option>{models.map((item) => <option key={item}>{item}</option>)}</select></label></div></header>
      {filteredRecords.length ? <div className="table-wrap"><table className="mobile-card-table"><thead><tr><th>{zh ? "日期" : "Date"}</th><th>{zh ? "资产" : "Asset"}</th><th>{zh ? "模型" : "Model"}</th><th>{horizon} {zh ? "预测" : "Forecast"}</th><th>{horizon} {zh ? "实际" : "Actual"}</th><th>{zh ? "状态" : "Status"}</th></tr></thead><tbody>{filteredRecords.slice(0, 60).map((row, index) => {
        const actual = row[`Actual_${horizon}_Return`];
        return <tr key={`${String(row.Symbol)}-${String(row.As_Of_Date)}-${index}`}>
          <td data-label={zh ? "日期" : "Date"}>{String(row.As_Of_Date || "—")}</td>
          <td data-label={zh ? "资产" : "Asset"}><strong>{String(row.Symbol || "—")}</strong></td>
          <td data-label={zh ? "模型" : "Model"}>{localizeRecordModel(String(row.Best_Model || "—"), zh)}</td>
          <td data-label={`${horizon} ${zh ? "预测" : "Forecast"}`}>{formatMetricPercentFromReturn(row[`Forecast_${horizon}_Return`])}</td>
          <td data-label={`${horizon} ${zh ? "实际" : "Actual"}`}>{formatMetricPercentFromReturn(actual)}</td>
          <td data-label={zh ? "状态" : "Status"}><span className={`record-state ${recordState(row, horizon)}`} title={reasonLabel(stateReasonCode(row, horizon), zh) || undefined}>{stateLabel(recordState(row, horizon), zh)}</span>{stateReasonCode(row, horizon) && <small className="record-state-reason">{reasonLabel(stateReasonCode(row, horizon), zh)}</small>}</td>
        </tr>;
      })}</tbody></table></div> : <p>{zh ? "当前筛选条件下暂无冻结预测记录。" : "No frozen records match these filters."}</p>}
    </section>
    <section className="score-methods"><article><ShieldCheck size={18} /><div><strong>{zh ? "自动结算与回滚" : "Automatic settlement and rollback"}</strong><p>{zh ? `每日只结算通过时间资格的冻结预测，用目标交易日的不复权收盘价计算 1日、5日、10日和1个月结果，结算后不可改写。每个资产当前预测政策版本的合格 1D 样本不足 ${QUALIFIED_SAMPLE_GOAL} 个，或准确率 95% 区间下限未高于简单基准时，使用保守组合且不给操作建议；达到门槛后，近 20 个合格样本失去优势仍会触发观察或安全回退。` : `Only time-qualified frozen forecasts are settled, using unadjusted target-session closes for 1D, 5D, 10D and 1M, and settled results are immutable. Until an asset has ${QUALIFIED_SAMPLE_GOAL} qualified 1D samples under the current forecast policy with the 95% lower bound of accuracy above the simple baseline, the conservative ensemble runs and no action calls are made; after that, loss of edge over the latest 20 qualified samples still triggers watch or safe rollback.`}</p></div></article><article><BrainCircuit size={18} /><div><strong>{zh ? "官方 Kronos 批量模型" : "Official Kronos batch model"}</strong><p>{zh ? "使用 NeoQuasar 官方 Kronos-mini 离线推理；只有批次日期与最新行情一致时才以有限权重加入组合。" : "Official NeoQuasar Kronos-mini runs offline and enters the ensemble at a capped weight only when its batch date matches current market data."}</p></div></article></section>
    <section className="score-assets"><header><h2>{zh ? "核心资产明细" : "Core asset detail"}</h2><small>{data.data_as_of}</small></header><div>{data.per_asset.map((asset) => {
      const assetBacktest = all(asset.backtest.statistics);
      const assetLive = all(qualifiedStats(asset.live.statistics));
      const governance = asset.governance;
      return <article key={asset.symbol}><header><strong>{asset.symbol}</strong><span className={`governance-status ${governance?.status || "warming_up"}`}>{statusLabel(governance?.status || "warming_up", zh)}</span></header><dl><div><dt>{zh ? "回测优势" : "Backtest edge"}</dt><dd>{formatMetricPercent(assetBacktest?.direction_edge, true)}</dd></div><div><dt>{zh ? "合格样本（当前版本）" : "Qualified samples (current policy)"}</dt><dd>{governance?.evidence_gate ? `${governance.evidence_gate.samples}/${governance.evidence_gate.required}` : assetLive ? assetLive.completed : "—"}</dd></div><div><dt>{zh ? "实盘命中率" : "Live hit rate"}</dt><dd>{accuracyWithInterval(assetLive, zh)}</dd></div><div><dt>{zh ? "实盘优势" : "Live edge"}</dt><dd>{formatMetricPercent(assetLive?.direction_edge, true)}</dd></div><div><dt>Kronos</dt><dd>{asset.kronos?.data_as_of || (zh ? "等待批次" : "Awaiting batch")}</dd></div></dl><p>{governance ? (zh ? governance.reason_zh : governance.reason_en) : (zh ? "模型治理样本正在建立。" : "Model-governance evidence is accumulating.")}</p></article>;
    })}</div></section>
    <p className="score-note">{zh ? "方向优势 = 模型方向准确率 - 同期多数类基准准确率。历史结果不代表未来表现。" : "Direction edge equals model directional accuracy minus the contemporaneous majority-class baseline. Historical results do not guarantee future performance."}</p>
  </main>;
}

function recordMarket(symbol: string): "us" | "a" | "hk" | "other" {
  if (/\.(SH|SZ|BJ)$/i.test(symbol)) return "a";
  if (/\.HK$/i.test(symbol)) return "hk";
  if (!symbol.includes(".")) return "us";
  return "other";
}

function localizeRecordModel(value: string, zh: boolean): string {
  return localizeModel(value, zh ? "zh" : "en");
}

function formatMetricPercentFromReturn(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? formatMetricPercent(value * 100, true) : "—";
}

function downloadForecastCsv(rows: LedgerRecord[], horizon: string, zh: boolean): void {
  const columns = ["As_Of_Date", "Symbol", "Best_Model", `Forecast_${horizon}_Return`, `Actual_${horizon}_Return`];
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const header = [...columns, "Eligibility_State", "Eligibility_Reason"];
  const csv = [header.join(","), ...rows.map((row) => [...columns.map((column) => escape(row[column])),
    escape(recordState(row, horizon)), escape(reasonLabel(stateReasonCode(row, horizon), zh))].join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `orivane-frozen-forecasts-${horizon.toLowerCase()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
