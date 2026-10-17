"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bell, BookmarkX, RefreshCw } from "lucide-react";
import { assetPath, catalogAssetBySymbol } from "@/lib/asset-catalog";
import { canonicalSymbol, displayAssetName } from "@/lib/assets";
import { formatNumber, formatPercent } from "@/lib/format";
import { buildResearchQueue, researchSemantics, deriveResearchCoverage, readResearchBaseline, seedResearchBaseline, writeResearchBaseline, type ResearchReason, type ResearchDataEntry } from "@/lib/my-research";
import type { Asset, PriceAlert, ResearchReview, ResearchReviewEvent } from "@/lib/types";
import { AppLink as Link } from "./app-link";
import { ResearchReviewButton, ReviewSavedNotice, ReviewEventLink } from "./research-review";
import { AssetLogo } from "./asset-logo";
import { useApp } from "./providers";
import { researchRecords } from "@/lib/research-record";
import { recordTracking } from "@/lib/research-record-review";
import { useMyResearch } from "./use-my-research";
import s from "./my-research.module.css";

export function MyResearchWorkspace({ onPresetAlert }: { onPresetAlert: (asset: Asset, type: PriceAlert["type"], value: number | string) => void }) {
  const { userState, favorites, privateStorage, language, toggleFavorite, updateUserState } = useApp();
  const zh = language === "zh";
  const [completed, setCompleted] = useState<ResearchReviewEvent | null>(null);
  const records = researchRecords(userState);
  const recentReview = records.flatMap(record => recordTracking(record, userState).events).sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at))[0];
  // Membership comes from the saved lists, never from a truncated/failed identity lookup.
  const symbols = [...new Set(userState.watchlists.flatMap((list) => list.symbols).map(canonicalSymbol).filter(Boolean))];
  const { entries, loading, lastCheckedAt, refresh } = useMyResearch(symbols);
  const [baseline, setBaseline] = useState(() => readResearchBaseline(privateStorage));
  const [newBaselines, setNewBaselines] = useState<string[]>([]);
  const [baselineStored, setBaselineStored] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [recents] = useState(() => {
    try {
      const stored: unknown = JSON.parse(privateStorage.getItem("orivane-recent-symbols") || "[]");
      return Array.isArray(stored) ? [...new Set(stored.filter((item): item is string => typeof item === "string").map(canonicalSymbol))].filter(Boolean).slice(0, 6) : [];
    } catch { return []; }
  });
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const next = seedResearchBaseline(baseline, entries);
    const added = Object.keys(next).filter((symbol) => !baseline[symbol]);
    if (!added.length) return;
    writeResearchBaseline(privateStorage, next);
    const persisted = readResearchBaseline(privateStorage);
    setBaselineStored(added.every((symbol) => Boolean(persisted[symbol])));
    setNewBaselines((current) => [...new Set([...current, ...added])]);
    setBaseline(next);
  }, [baseline, entries, privateStorage]);
  const tasks = buildResearchQueue({ symbols, reviews: userState.research_reviews, alerts: userState.alerts, alertHistory: userState.alert_history, baseline, entries, records: userState.research_records, reviewEvents: userState.research_review_events, now: new Date(now) });
  const assetBySymbol = useMemo(() => new Map(favorites.map((asset) => [asset.symbol, asset])), [favorites]);
  const identity = (symbol: string) => entries[symbol]?.asset || assetBySymbol.get(symbol) || catalogAssetBySymbol(symbol);
  // Receipt can be later than the last minute tick; use the current render clock for ages.
  const displayNow = Date.now();
  const { checked, failed, stale, unchecked, complete, partial, unavailable, processed } = deriveResearchCoverage(symbols, entries, baseline, displayNow);
  const resolved = symbols.filter((symbol) => Boolean(identity(symbol)?.name)).length;
  const noBaseline = symbols.filter((symbol) => !baseline[symbol] || newBaselines.includes(symbol)).length;
  const taskSymbols = new Set(tasks.map((task) => task.symbol));
  const unconfirmed = symbols.length - checked;
  const removeFavorite = (symbol: string) => {
    const favorite = assetBySymbol.get(symbol);
    if (favorite) toggleFavorite(favorite);
    updateUserState((current) => ({ ...current, watchlists: current.watchlists.map((list) => ({ ...list, symbols: list.symbols.filter((item) => canonicalSymbol(item) !== symbol) })) }));
  };
  const title = (symbol: string) => {
    const asset = identity(symbol);
    return <span className={s.identity}>{asset && <AssetLogo asset={asset} size="small" />}<span><strong>{asset ? displayAssetName(asset, language) : symbol}</strong><small>{symbol}{asset ? ` · ${typeLabel(asset, zh)}` : ` · ${zh ? "身份待解析" : "Identity unresolved"}`}</small></span></span>;
  };

  return <div className={s.workspace}>
    <div className={s.coverage}>
      <div role="status" aria-live="polite" data-testid="research-coverage">
        <strong>{zh ? `已读取 ${processed}/${symbols.length} · 完整 ${complete} · 部分 ${partial} · 暂无数据 ${unavailable}` : `Read ${processed}/${symbols.length} · Complete ${complete} · Partial ${partial} · Unavailable ${unavailable}`}</strong>
        <p><span className={stale ? s.warning : undefined}>{zh ? `${stale} 只含超期缓存` : `${stale} with expired cache`}</span>{zh ? ` · 当前可比较 ${checked} 只` : ` · Currently comparable ${checked}`}</p>
        {(failed > 0 || unchecked > 0) && <p className={s.warning}>{zh ? `${failed} 项获取失败 · ${unchecked} 项尚未读取` : `${failed} failed · ${unchecked} unchecked`}{loading ? (zh ? " · 分批读取中" : " · Reading batches") : ""}</p>}
        <p>{zh ? `总计 ${symbols.length} · 已解析 ${resolved}` : `Total ${symbols.length} · Resolved ${resolved}`}{lastCheckedAt ? ` · ${zh ? "最近读取尝试" : "Last read attempt"} ${new Date(lastCheckedAt).toLocaleTimeString(zh ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" })}` : ""}</p>
      </div>
      <button type="button" onClick={refresh} disabled={loading || !symbols.length}><RefreshCw size={14} />{zh ? "刷新数据" : "Refresh data"}</button>
      <details><summary>{zh ? "检查口径与比较基准" : "Coverage and comparison baseline"}</summary><p>{zh ? "已读取 = 完整 + 部分 + 暂无数据；已读取 + 获取失败 + 尚未读取 = 总计。超期缓存独立统计，包含部分数据及失败后保留的旧值，不参与上述求和。当前可比较沿用现有准入规则，不代表已经完成历史对照或复核。刷新只重读已有存储，不生成预测或拉取新行情。" : "Read = complete + partial + unavailable; read + failed + unchecked = total. Expired cache is independent and includes partial data and retained values after a failure. Comparable uses the existing eligibility rules; it does not mean a baseline comparison or review is complete. Refresh only reads stored data; it does not fetch market data or generate forecasts."}</p><p>{zh ? "市场时效待核验：本轮没有交易日历或收盘完整性确认。完整数据客户端复用最多15分钟；部分、无数据及失败仅短期复用30秒。行情服务端复用最多30分钟，预测复用最多30小时，另受数据日期上限等现有规则约束。缓存超期不等于行情落后；预测复用期限已过也不代表预测结论失效。缺失时间显示未提供，不作推断。" : "Market freshness is unverified: no trading calendar or completed-session verification is available. Complete client data is reused for up to 15 minutes; partial, missing and failed results only for 30 seconds. Server market-cache reuse up to 30 minutes and forecast reuse up to 30 hours, subject to existing date limits. Cache expiry does not establish market lag or invalidate a forecast conclusion. Missing times are not inferred."}</p><p>{zh ? "比较基准固定在本机首次成功检查的数据；刷新、查看和标记提醒已读均不代表完成复核。这些自动变化不提供完成归档；变化恢复到基准时可能不再显示。个人研究判断的人工复核另行保存历史，不推进此基准。" : "The baseline is pinned to this device’s first successful check. Refreshing, viewing and reading notifications do not complete a review. Completion archives and cross-device events are not available; changes that revert to baseline may disappear without intermediate history."}</p></details>
    </div>

    {!baselineStored && <p className={s.warning} role="alert">{zh ? "比较基准未能保存到本机；本次仍可查看数据，下次访问可能需要重新建立基准。" : "The baseline could not be saved locally. Data remains usable, but the next visit may need a new baseline."}</p>}
    <section className={s.section} aria-labelledby="research-actions-title">
      <header><h2 id="research-actions-title" tabIndex={-1}>{zh ? "今天需要处理" : "Today’s action queue"}</h2><span>{zh ? `${tasks.length} 个资产` : `${tasks.length} assets`}</span></header>
      {completed ? <ReviewSavedNotice event={completed} /> : recentReview && <p className={s.note}>{zh ? "最近完成的复核" : "Most recent review"} · {date(recentReview.reviewed_at, zh)} <ReviewEventLink event={recentReview} /></p>}
      {!tasks.length && records.length > 0 && <p role="status" className={s.empty}>{zh ? "当前没有待处理的复核" : "No reviews currently require action"}</p>}
      {tasks.length ? <div className={s.queue}>{tasks.map((task) => <article className={s.task} key={task.symbol} data-testid="research-task">
        <header>{title(task.symbol)}<span className={s.priority}>{zh ? "待复核" : "Review needed"}</span></header>
        <ul>{task.reasons.map((reason) => <li key={reason.id}>{reasonText(reason, zh)}{reason.kind === "record_review_due" && <ResearchReviewButton record={reason.record} compact onSaved={setCompleted} />}</li>)}</ul>
        {userState.research_reviews?.[task.symbol] && <ReviewContext review={userState.research_reviews[task.symbol]} zh={zh} />}
        <footer><Link className={s.primary} href={assetPath(task.symbol)}>{zh ? "进入研究" : "Open research"}<ArrowRight size={14} /></Link><small>{zh ? "打开研究不会清除事项" : "Opening does not dismiss this item"}</small></footer>
      </article>)}</div> : records.length > 0 && !symbols.length ? null : <p className={s.empty} role="status">{!records.length && !symbols.length && !Object.keys(userState.research_reviews || {}).length ? (zh ? "先研究一只资产，关注或保存复核计划后，这里会汇总需要处理的事项。" : "Research an asset, then follow it or save a review plan to build your queue.") : unconfirmed ? (zh ? "尚不能确认全部关注资产的变化；请查看失败、缺失、缓存和未检查状态。" : "Changes cannot yet be confirmed for the entire watchlist. Check failed, missing, stale and unchecked states.") : noBaseline ? (zh ? "尚无历史比较基准；首次成功数据作为本机基准，下次访问开始比较。" : "No earlier comparison baseline. The first successful data provides a local baseline for your next visit.") : (zh ? "已检查的资产暂无需要处理的重要变化或到期计划。" : "Checked assets have no meaningful changes or due plans requiring action.")}</p>}
      {Object.values(userState.research_reviews || {}).some((review) => Date.parse(review.due_at) > now) && <details className={s.scheduled}><summary>{zh ? "查看尚未到期的价格/条件复核计划" : "View upcoming price / condition plans"}</summary>{Object.values(userState.research_reviews || {}).filter((review) => Date.parse(review.due_at) > now).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at)).map((review) => <article key={review.symbol}><Link href={assetPath(review.symbol)}>{title(review.symbol)}</Link><ReviewContext review={review} zh={zh} /></article>)}</details>}
      {tasks.length > 0 && unconfirmed > 0 && <p className={s.note}>{zh ? "队列包含已有计划和历史提醒；部分数据尚未确认，不能据此判断其他资产没有变化。" : "The queue includes saved plans and historical alerts. Incomplete checks do not imply no changes elsewhere."}</p>}
    </section>

    <section className={s.section} aria-labelledby="research-watchlist-title">
      <header><h2 id="research-watchlist-title">{zh ? "我的关注" : "My watchlist"}</h2><span>{zh ? `${symbols.length} 个资产` : `${symbols.length} assets`}</span></header>
      {!symbols.length ? <div className={s.empty}><p>{zh ? "本机当前没有可显示的关注资产。可以从一次研究开始，不需要凑齐关注数量。" : "No followed assets are currently loaded on this device. Start with one research visit; there is no required watchlist size."}</p><Link href="/">{zh ? "查找资产" : "Find an asset"}<ArrowRight size={14} /></Link></div> : <div className={s.watchlist}>{symbols.map((symbol) => {
        const entry = entries[symbol];
        const asset = identity(symbol);
        const semantics = researchSemantics(entry, displayNow);
        const status = semantics.execution === "processed" ? semantics.completeness! : semantics.execution;
        const review = userState.research_reviews?.[symbol];
        return <article className={s.asset} key={symbol} data-testid="research-asset">
          <header>{title(symbol)}<span className={`${s.status} ${status !== "complete" ? s.warning : ""}`}>{stateLabel(status, zh)}</span></header>
          {semantics.execution === "failed" && <p className={s.warning}>{zh ? "本次获取失败" : "This read failed"}{semantics.retained ? (zh ? "；保留上次可用值，不计入本次已读取或完整数据。" : "; last available values retained, excluded from this read’s completeness counts.") : ""}</p>}
          <p className={s.note}>{zh ? "市场时效待核验" : "Market freshness unverified"} · {semantics.freshness.checked ? (zh ? "满足现有比较条件" : "Meets existing comparison rules") : (zh ? "当前不可比较" : "Not currently comparable")}</p>
          {(semantics.freshness.clientExpired || semantics.freshness.historyExpired || semantics.freshness.forecastExpired) && <p className={s.warning}>{[
            semantics.freshness.clientExpired && (zh ? "客户端缓存超期" : "Client cache expired"),
            semantics.freshness.historyExpired && (zh ? "行情缓存复用期限已过" : "Market cache reuse period elapsed"),
            semantics.freshness.forecastExpired && (zh ? "预测复用期限已过" : "Forecast reuse period elapsed"),
          ].filter(Boolean).join(" · ")}</p>}
          <dl className={s.metrics}><div><dt>{zh ? "现价" : "Price"}</dt><dd>{metric(entry?.history?.snapshot.latest_price, false)}</dd></div><div><dt>{zh ? "1D 涨跌" : "1D return"}</dt><dd>{metric(entry?.history?.snapshot.return_1d, true)}</dd></div><div><dt>{zh ? "1M 预测" : "1M forecast"}</dt><dd>{metric(entry?.forecast?.forecast_1m_return, true)}</dd></div><div><dt>{zh ? "20日年化波动率" : "20D annualized volatility"}</dt><dd>{metric(entry?.history?.snapshot.annualized_volatility_20d, true, false)}</dd></div></dl>
          <p className={s.note}>{zh ? "行情" : "Market"} {entry?.history?.data_as_of || "—"} · {zh ? "预测" : "Forecast"} {entry?.forecast?.data_as_of || "—"}</p>
          {entry && <SourceDetails entry={entry} now={displayNow} zh={zh} />}
          {semantics.freshness.checked && <p className={s.note}>{taskSymbols.has(symbol) ? (zh ? "有待复核事项，见上方队列。" : "Review items are in the queue above.") : !baseline[symbol] || newBaselines.includes(symbol) ? (zh ? "无历史比较基准 · 本次建立本机基准" : "No prior baseline · Baseline established locally") : (zh ? "已对照基准 · 无实质方向变化" : "Compared with baseline · No material direction change")}</p>}
          {review && <ReviewContext review={review} zh={zh} />}
          <footer><Link className={s.primary} href={assetPath(symbol)}>{zh ? "查看研究" : "View research"}<ArrowRight size={14} /></Link><button type="button" onClick={() => removeFavorite(symbol)} aria-label={`${zh ? "取消关注" : "Unfollow"} ${symbol}`}><BookmarkX size={14} /></button>{asset && <button type="button" onClick={() => onPresetAlert(asset, "signal", "any")}><Bell size={14} />{zh ? "方向提醒" : "Signal alert"}</button>}</footer>
        </article>;
      })}</div>}
    </section>

    <section className={s.section} aria-labelledby="research-recent-title"><header><h2 id="research-recent-title">{zh ? "最近查看" : "Recently viewed"}</h2><span>{zh ? "本机记录" : "This device"}</span></header>{recents.length ? <nav className={s.recents}>{recents.map((symbol) => <Link href={assetPath(symbol)} key={symbol}>{title(symbol)}<ArrowRight size={14} /></Link>)}</nav> : <p className={s.empty}>{zh ? "查看资产后会在这里留下继续研究的入口。" : "Viewed assets will appear here for quick access."}</p>}</section>
  </div>;
}

function ReviewContext({ review, zh }: { review: ResearchReview; zh: boolean }) {
  const labels = { next_session: zh ? "预定日期复核" : "Scheduled review", breakout: zh ? "计划：突破关键位时复核" : "Plan: review on breakout", pullback: zh ? "计划：回踩支撑时复核" : "Plan: review on pullback", invalidation: zh ? "计划：触及失效位时复核" : "Plan: review at invalidation" };
  return <div className={s.review}><strong>{labels[review.reason]}</strong><span>{zh ? "预定复核" : "Due"} {date(review.due_at, zh)} · {zh ? "参考价" : "Reference price"} {metric(review.reference_price, false)} · {zh ? "计划关键位" : "Planned level"} {metric(review.trigger_price, false)}</span>{review.reason !== "next_session" && <small>{zh ? "按预定日期提示；当前未确认该价格条件已触发。" : "Scheduled by date; this price condition has not been confirmed as triggered."}</small>}<small>{zh ? "这是独立的价格/条件复核计划，不属于研究判断的复核历史。" : "A separate price / condition plan, outside judgment review history."}</small></div>;
}
function reasonText(reason: ResearchReason, zh: boolean): string {
  if (reason.kind === "record_review_due") return `${zh ? "研究判断到期" : "Judgment review due"} · ${reason.dueDate} · ${reason.record.reason.slice(0, 80)} · `;
  if (reason.kind === "review_due") return `${zh ? "价格/条件计划已到复核时间" : "Price / condition plan is due"} · ${date(reason.review.due_at, zh)}`;
  if (reason.kind === "direction_change") return `${reason.pendingConfirmation ? (zh ? "上次数据方向变化（待更新确认）" : "Last known reversal (refresh unconfirmed)") : (zh ? "预测方向实质变化" : "Material forecast reversal")}：${signal(reason.previous.signal, zh)} → ${signal(reason.current.signal, zh)}`;
  if (reason.kind === "price_condition") return `${zh ? "用户条件命中" : "User condition met"} · ${alertType(reason.alert.type, zh)} ${reason.alert.value}${reason.alert.type === "change" ? "%" : ""} · ${zh ? "当前" : "Current"} ${formatNumber(reason.current)}${reason.alert.type === "change" ? "%" : ""} · ${reason.dataAsOf}`;
  return `${zh ? "历史提醒" : "Recorded alert"} · ${alertType(reason.alert.type, zh)} · ${date(reason.history.triggered_at, zh)}${reason.history.read_at ? (zh ? " · 已读，未代表已复核" : " · Read, not marked reviewed") : ""}`;
}
function alertType(type: PriceAlert["type"], zh: boolean) { return ({ above: zh ? "高于设定价格" : "Above your price", below: zh ? "低于设定价格" : "Below your price", change: zh ? "日涨跌达到阈值" : "Daily move threshold", signal: zh ? "预测方向提醒" : "Forecast signal", confidence: zh ? "可信度阈值" : "Confidence threshold", invalidation: zh ? "模型失效位提醒" : "Model invalidation" })[type]; }
function signal(value: string, zh: boolean) { return zh ? ({ Up: "偏多", Down: "偏空", Observe: "观察" }[value] || value) : value; }
function date(value: string, zh: boolean) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString(zh ? "zh-CN" : "en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; }
function metric(value: unknown, percent: boolean, signed = true) { return typeof value === "number" && Number.isFinite(value) ? percent ? formatPercent(value, signed) : formatNumber(value) : "—"; }
function typeLabel(asset: Asset, zh: boolean) { return zh ? ({ stock: "股票", etf: "ETF", fund: "基金", index: "指数", currency: "外汇", market: "市场" })[asset.asset_type] : asset.asset_type.toUpperCase(); }
function stateLabel(status: string, zh: boolean) { return ({ complete: zh ? "完整" : "Complete", partial: zh ? "部分可用" : "Partial", unavailable: zh ? "暂无数据" : "Unavailable", failed: zh ? "获取失败" : "Failed", unchecked: zh ? "尚未读取" : "Unchecked" })[status] || status; }

function SourceDetails({ entry, now, zh }: { entry: ResearchDataEntry; now: number; zh: boolean }) {
  const { freshness } = researchSemantics(entry, now);
  const history = entry.source?.history, forecast = entry.source?.forecast;
  const missing = zh ? "未提供" : "Not provided";
  const time = (value: string | number | null | undefined) => value !== null && value !== undefined && Number.isFinite(new Date(value).getTime()) ? date(new Date(value).toISOString(), zh) : missing;
  const age = (ms: number | null) => ms === null ? (zh ? "年龄未知" : "Age unknown") : ms < 60_000 ? (zh ? "不足1分钟" : "Under 1 minute") : ms < 3600_000 ? (zh ? `${Math.floor(ms / 60_000)}分钟` : `${Math.floor(ms / 60_000)} min`) : (zh ? `${Math.floor(ms / 3600_000)}小时` : `${Math.floor(ms / 3600_000)} hr`);
  const sourceState = (source: typeof history, expired: boolean) => {
    if (!source) return missing;
    if (source.status === "failed") return zh ? "本次读取失败" : "Read failed";
    if (source.status === "unavailable") return zh ? "暂无数据" : "Unavailable";
    if (expired) return zh ? "复用期限已过" : "Reuse period elapsed";
    if (source.reason === "market_date_mismatch") return zh ? "行情与预测日期不一致" : "Market and forecast dates differ";
    if (source.status === "stale" || !source.expires_at) return zh ? "复用资格待确认" : "Reuse eligibility unconfirmed";
    return zh ? "复用期限内（不保证市场时效）" : "Within reuse period (market freshness unverified)";
  };
  return <details className={s.sources}><summary>{zh ? "来源与缓存时间" : "Sources and cache times"}</summary><dl>
    <div><dt>{zh ? "行情 data_as_of" : "Market data_as_of"}</dt><dd>{entry.history?.data_as_of || missing}</dd></div>
    <div><dt>{zh ? "行情 KV 存储时间" : "Market KV stored at"}</dt><dd>{time(history?.stored_at)} · {age(freshness.historyAgeMs)}</dd></div>
    <div><dt>{zh ? "行情服务端复用截止" : "Market server reuse until"}</dt><dd>{time(history?.expires_at)} · {sourceState(history, freshness.historyExpired)}</dd></div>
    <div><dt>{zh ? "预测 data_as_of" : "Forecast data_as_of"}</dt><dd>{entry.forecast?.data_as_of || missing}</dd></div>
    <div><dt>{zh ? "预测生成时间" : "Forecast generated at"}</dt><dd>{time(forecast?.generated_at)} · {age(freshness.forecastAgeMs)}</dd></div>
    <div><dt>{zh ? "预测复用截止" : "Forecast reuse until"}</dt><dd>{time(forecast?.expires_at)} · {sourceState(forecast, freshness.forecastExpired)}</dd></div>
    <div><dt>{zh ? "客户端接收时间" : "Client received at"}</dt><dd>{time(entry.checkedAt)} · {age(freshness.clientAgeMs)}</dd></div>
    <div><dt>{zh ? "客户端缓存" : "Client cache"}</dt><dd>{freshness.clientAgeMs === null ? (zh ? "复用年龄未知" : "Reuse age unknown") : freshness.clientExpired ? (zh ? "已超过15分钟复用期限" : "Beyond the 15-minute reuse period") : (zh ? "接收未满15分钟；不代表源数据仍有效" : "Received within 15 minutes; source eligibility is separate")}</dd></div>
  </dl></details>;
}
