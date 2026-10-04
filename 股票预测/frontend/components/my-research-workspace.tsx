"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bell, BookmarkX, RefreshCw } from "lucide-react";
import { assetPath, catalogAssetBySymbol } from "@/lib/asset-catalog";
import { canonicalSymbol, displayAssetName } from "@/lib/assets";
import { formatNumber, formatPercent } from "@/lib/format";
import { buildResearchQueue, completeResearchEntry, deriveResearchCoverage, readResearchBaseline, seedResearchBaseline, writeResearchBaseline, type ResearchReason } from "@/lib/my-research";
import type { Asset, PriceAlert, ResearchReview } from "@/lib/types";
import { AppLink as Link } from "./app-link";
import { AssetLogo } from "./asset-logo";
import { useApp } from "./providers";
import { useMyResearch } from "./use-my-research";
import s from "./my-research.module.css";

export function MyResearchWorkspace({ onPresetAlert }: { onPresetAlert: (asset: Asset, type: PriceAlert["type"], value: number | string) => void }) {
  const { userState, favorites, privateStorage, language, toggleFavorite, updateUserState } = useApp();
  const zh = language === "zh";
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
  const tasks = buildResearchQueue({ symbols, reviews: userState.research_reviews, alerts: userState.alerts, alertHistory: userState.alert_history, baseline, entries, now: new Date(now) });
  const assetBySymbol = useMemo(() => new Map(favorites.map((asset) => [asset.symbol, asset])), [favorites]);
  const identity = (symbol: string) => entries[symbol]?.asset || assetBySymbol.get(symbol) || catalogAssetBySymbol(symbol);
  const { checked, failed, stale, unchecked } = deriveResearchCoverage(symbols, entries, baseline);
  const resolved = symbols.filter((symbol) => Boolean(identity(symbol)?.name)).length;
  const noBaseline = symbols.filter((symbol) => !baseline[symbol] || newBaselines.includes(symbol)).length;
  const taskSymbols = new Set(tasks.map((task) => task.symbol));
  const unconfirmed = failed + stale + unchecked;
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
      <div role="status" aria-live="polite"><strong>{zh ? `已检查 ${checked}/${symbols.length}` : `Checked ${checked}/${symbols.length}`}{failed > 0 && <span className={s.warning}>{zh ? ` · ${failed} 项获取失败` : ` · ${failed} failed`}</span>}{stale > 0 && <span className={s.warning}>{zh ? ` · ${stale} 项缓存待更新` : ` · ${stale} stale`}</span>}</strong>
        <p>{zh ? `总计 ${symbols.length} · 已解析 ${resolved} · 未检查 ${unchecked}` : `Total ${symbols.length} · Resolved ${resolved} · Unchecked ${unchecked}`}{loading ? (zh ? " · 分批检查中" : " · Checking batches") : ""}{lastCheckedAt ? ` · ${zh ? "最近检查" : "Last checked"} ${new Date(lastCheckedAt).toLocaleTimeString(zh ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" })}` : ""}</p>
      </div>
      <button type="button" onClick={refresh} disabled={loading || !symbols.length}><RefreshCw size={14} />{zh ? "刷新数据" : "Refresh data"}</button>
      <details><summary>{zh ? "检查口径与比较基准" : "Coverage and comparison baseline"}</summary><p>{zh ? "已检查仅包含本次可用的完整行情与预测；失败、缓存待更新、未检查分别列出。缓存新鲜度不代表实时行情，请同时查看数据日期。" : "Checked means a complete usable market and forecast response. Failed, stale and unchecked assets are separate. Cache freshness does not mean real-time market data; check the data dates."}</p><p>{zh ? "比较基准固定在本机首次成功检查的数据；刷新、查看和标记提醒已读均不代表完成复核。本轮不提供完成归档或跨设备事件同步；变化恢复到基准时可能不再显示，不保留中间事件。" : "The baseline is pinned to this device’s first successful check. Refreshing, viewing and reading notifications do not complete a review. Completion archives and cross-device events are not available; changes that revert to baseline may disappear without intermediate history."}</p></details>
    </div>

    {!baselineStored && <p className={s.warning} role="alert">{zh ? "比较基准未能保存到本机；本次仍可查看数据，下次访问可能需要重新建立基准。" : "The baseline could not be saved locally. Data remains usable, but the next visit may need a new baseline."}</p>}
    <section className={s.section} aria-labelledby="research-actions-title">
      <header><h2 id="research-actions-title">{zh ? "今天需要处理" : "Today’s action queue"}</h2><span>{zh ? `${tasks.length} 个资产` : `${tasks.length} assets`}</span></header>
      {tasks.length ? <div className={s.queue}>{tasks.map((task) => <article className={s.task} key={task.symbol} data-testid="research-task">
        <header>{title(task.symbol)}<span className={s.priority}>{zh ? "待复核" : "Review needed"}</span></header>
        <ul>{task.reasons.map((reason) => <li key={reason.id}>{reasonText(reason, zh)}</li>)}</ul>
        {userState.research_reviews?.[task.symbol] && <ReviewContext review={userState.research_reviews[task.symbol]} zh={zh} />}
        <footer><Link className={s.primary} href={assetPath(task.symbol)}>{zh ? "进入研究" : "Open research"}<ArrowRight size={14} /></Link><small>{zh ? "打开研究不会清除事项" : "Opening does not dismiss this item"}</small></footer>
      </article>)}</div> : <p className={s.empty} role="status">{!symbols.length && !Object.keys(userState.research_reviews || {}).length ? (zh ? "先研究一只资产，关注或保存复核计划后，这里会汇总需要处理的事项。" : "Research an asset, then follow it or save a review plan to build your queue.") : unconfirmed ? (zh ? "尚不能确认全部关注资产的变化；请查看失败、缓存和未检查状态。" : "Changes cannot yet be confirmed for the entire watchlist. Check failed, stale and unchecked states.") : noBaseline ? (zh ? "尚无历史比较基准；首次成功数据作为本机基准，下次访问开始比较。" : "No earlier comparison baseline. The first successful data provides a local baseline for your next visit.") : (zh ? "已检查的资产暂无需要处理的重要变化或到期计划。" : "Checked assets have no meaningful changes or due plans requiring action.")}</p>}
      {Object.values(userState.research_reviews || {}).some((review) => Date.parse(review.due_at) > now) && <details className={s.scheduled}><summary>{zh ? "查看尚未到期的复核计划" : "View upcoming review plans"}</summary>{Object.values(userState.research_reviews || {}).filter((review) => Date.parse(review.due_at) > now).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at)).map((review) => <article key={review.symbol}><Link href={assetPath(review.symbol)}>{title(review.symbol)}</Link><ReviewContext review={review} zh={zh} /></article>)}</details>}
      {tasks.length > 0 && unconfirmed > 0 && <p className={s.note}>{zh ? "队列包含已有计划和历史提醒；部分数据尚未确认，不能据此判断其他资产没有变化。" : "The queue includes saved plans and historical alerts. Incomplete checks do not imply no changes elsewhere."}</p>}
    </section>

    <section className={s.section} aria-labelledby="research-watchlist-title">
      <header><h2 id="research-watchlist-title">{zh ? "我的关注" : "My watchlist"}</h2><span>{zh ? `${symbols.length} 个资产` : `${symbols.length} assets`}</span></header>
      {!symbols.length ? <div className={s.empty}><p>{zh ? "本机当前没有可显示的关注资产。可以从一次研究开始，不需要凑齐关注数量。" : "No followed assets are currently loaded on this device. Start with one research visit; there is no required watchlist size."}</p><Link href="/">{zh ? "查找资产" : "Find an asset"}<ArrowRight size={14} /></Link></div> : <div className={s.watchlist}>{symbols.map((symbol) => {
        const entry = entries[symbol];
        const asset = identity(symbol);
        const status = entry?.status === "fresh" && !completeResearchEntry(entry) ? "failed" : entry?.status || "unchecked";
        const review = userState.research_reviews?.[symbol];
        return <article className={s.asset} key={symbol} data-testid="research-asset">
          <header>{title(symbol)}<span className={`${s.status} ${status === "failed" || status === "stale" ? s.warning : ""}`}>{stateLabel(status, zh)}</span></header>
          {entry?.errors.length ? <p className={s.warning}>{[...new Set(entry.errors.map((error) => errorLabel(error.kind, zh)))].join(" · ")}{entry.history || entry.forecast ? (zh ? "；保留可用数据，不能确认全部变化。" : "; available data retained; changes are not fully confirmed.") : ""}</p> : null}
          <dl className={s.metrics}><div><dt>{zh ? "现价" : "Price"}</dt><dd>{metric(entry?.history?.snapshot.latest_price, false)}</dd></div><div><dt>{zh ? "1D 涨跌" : "1D return"}</dt><dd>{metric(entry?.history?.snapshot.return_1d, true)}</dd></div><div><dt>{zh ? "1M 预测" : "1M forecast"}</dt><dd>{metric(entry?.forecast?.forecast_1m_return, true)}</dd></div><div><dt>{zh ? "20日年化波动率" : "20D annualized volatility"}</dt><dd>{metric(entry?.history?.snapshot.annualized_volatility_20d, true, false)}</dd></div></dl>
          <p className={s.note}>{zh ? "行情" : "Market"} {entry?.history?.data_as_of || "—"} · {zh ? "预测" : "Forecast"} {entry?.forecast?.data_as_of || "—"}</p>
          {status === "fresh" && <p className={s.note}>{taskSymbols.has(symbol) ? (zh ? "有待复核事项，见上方队列。" : "Review items are in the queue above.") : !baseline[symbol] || newBaselines.includes(symbol) ? (zh ? "无历史比较基准 · 本次建立本机基准" : "No prior baseline · Baseline established locally") : (zh ? "已检查 · 无实质方向变化" : "Checked · No material direction change")}</p>}
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
  return <div className={s.review}><strong>{labels[review.reason]}</strong><span>{zh ? "预定复核" : "Due"} {date(review.due_at, zh)} · {zh ? "参考价" : "Reference price"} {metric(review.reference_price, false)} · {zh ? "计划关键位" : "Planned level"} {metric(review.trigger_price, false)}</span>{review.reason !== "next_session" && <small>{zh ? "按预定日期提示；当前未确认该价格条件已触发。" : "Scheduled by date; this price condition has not been confirmed as triggered."}</small>}<small>{zh ? "本轮仅保留计划，不提供完成结果或历史归档。" : "This is a plan, without completion results or an archive."}</small></div>;
}
function reasonText(reason: ResearchReason, zh: boolean): string {
  if (reason.kind === "review_due") return `${zh ? "计划已到复核时间" : "Scheduled review is due"} · ${date(reason.review.due_at, zh)}`;
  if (reason.kind === "direction_change") return `${reason.pendingConfirmation ? (zh ? "上次数据方向变化（待更新确认）" : "Last known reversal (refresh unconfirmed)") : (zh ? "预测方向实质变化" : "Material forecast reversal")}：${signal(reason.previous.signal, zh)} → ${signal(reason.current.signal, zh)}`;
  if (reason.kind === "price_condition") return `${zh ? "用户条件命中" : "User condition met"} · ${alertType(reason.alert.type, zh)} ${reason.alert.value}${reason.alert.type === "change" ? "%" : ""} · ${zh ? "当前" : "Current"} ${formatNumber(reason.current)}${reason.alert.type === "change" ? "%" : ""} · ${reason.dataAsOf}`;
  return `${zh ? "历史提醒" : "Recorded alert"} · ${alertType(reason.alert.type, zh)} · ${date(reason.history.triggered_at, zh)}${reason.history.read_at ? (zh ? " · 已读，未代表已复核" : " · Read, not marked reviewed") : ""}`;
}
function alertType(type: PriceAlert["type"], zh: boolean) { return ({ above: zh ? "高于设定价格" : "Above your price", below: zh ? "低于设定价格" : "Below your price", change: zh ? "日涨跌达到阈值" : "Daily move threshold", signal: zh ? "预测方向提醒" : "Forecast signal", confidence: zh ? "可信度阈值" : "Confidence threshold", invalidation: zh ? "模型失效位提醒" : "Model invalidation" })[type]; }
function signal(value: string, zh: boolean) { return zh ? ({ Up: "偏多", Down: "偏空", Observe: "观察" }[value] || value) : value; }
function date(value: string, zh: boolean) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString(zh ? "zh-CN" : "en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; }
function metric(value: unknown, percent: boolean, signed = true) { return typeof value === "number" && Number.isFinite(value) ? percent ? formatPercent(value, signed) : formatNumber(value) : "—"; }
function typeLabel(asset: Asset, zh: boolean) { return zh ? ({ stock: "股票", etf: "ETF", fund: "基金", index: "指数", currency: "外汇", market: "市场" })[asset.asset_type] : asset.asset_type.toUpperCase(); }
function stateLabel(status: string, zh: boolean) { return ({ loading: zh ? "检查中" : "Checking", fresh: zh ? "数据已检查" : "Data checked", stale: zh ? "缓存待更新" : "Stale cache", failed: zh ? "获取失败" : "Failed", unchecked: zh ? "尚未检查" : "Unchecked" })[status] || status; }
function errorLabel(kind: string, zh: boolean) { return ({ history: zh ? "行情缺失" : "Market data unavailable", forecast: zh ? "预测缺失" : "Forecast unavailable", asset: zh ? "资产解析失败" : "Identity unavailable", network: zh ? "网络更新失败" : "Network refresh failed" })[kind] || (zh ? "数据获取失败" : "Data unavailable"); }
