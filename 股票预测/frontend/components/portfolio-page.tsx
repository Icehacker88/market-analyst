"use client";

import { BrainCircuit, Plus, Send, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getAiAnalysis, getMarketSnapshots } from "@/lib/api";
import { compactChatThread, conversationForApi, createChatMessage } from "@/lib/ai-chat";
import { trackEvent } from "@/lib/analytics";
import { assetPath } from "@/lib/asset-catalog";
import { displayAssetName } from "@/lib/assets";
import { formatMetricPercent, formatNumber, formatPercent } from "@/lib/format";
import { calculatePortfolioAnalytics } from "@/lib/portfolio-analytics";
import { startForRange } from "@/lib/selection";
import type { AiAnalysis, AiChatMessage, Asset, Forecast, History, Portfolio, PortfolioHolding } from "@/lib/types";
import { AppLink as Link } from "./app-link";
import { useApp } from "./providers";
import { ResearchNavigation } from "./research-navigation";

export function PortfolioPage() {
  const { language, updateUserState, userState } = useApp();
  const zh = language === "zh";
  const portfolios = userState.portfolios;
  const active = portfolios[0];
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [histories, setHistories] = useState<Record<string, History>>({});
  const [forecasts, setForecasts] = useState<Record<string, Forecast>>({});
  const [researchLoading, setResearchLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDraft, setAiDraft] = useState("");
  const [aiError, setAiError] = useState("");
  const aiMessages = userState.portfolio_ai_chat?.messages || [];
  const holdings = active?.holdings || [];
  const holdingsKey = holdings.map((item) => `${item.symbol}:${item.quantity}:${item.cost}`).join("|");

  useEffect(() => { trackEvent("portfolio_view"); }, []);
  useEffect(() => {
    if (userState.portfolio_ai_chat?.messages.length) return;
    try {
      const legacy = JSON.parse(localStorage.getItem("orivane-portfolio-ai-v1") || "[]") as Array<Partial<AiChatMessage>>;
      if (!legacy.length) return;
      const messages = legacy.map((message) => createChatMessage(message.role === "assistant" ? "assistant" : "user", String(message.content || "")));
      updateUserState((current) => ({ ...current, portfolio_ai_chat: compactChatThread(messages) }));
    } catch { /* No legacy thread. */ }
  }, [updateUserState, userState.portfolio_ai_chat]);
  useEffect(() => {
    const symbols = [...new Set(holdings.map((item) => item.symbol))];
    if (!symbols.length) { setAssets({}); setHistories({}); setForecasts({}); return; }
    let activeRequest = true;
    setResearchLoading(true);
    getMarketSnapshots(symbols, startForRange("1Y"), "lite", "all").then((snapshots) => {
      if (!activeRequest) return;
      setAssets(Object.fromEntries(snapshots.map((item) => [item.asset.symbol, item.asset])));
      setHistories(Object.fromEntries(snapshots.flatMap((item) => item.history ? [[item.asset.symbol, item.history]] : [])));
      setForecasts(Object.fromEntries(snapshots.flatMap((item) => item.forecast ? [[item.asset.symbol, item.forecast]] : [])));
    }).catch(() => undefined).finally(() => { if (activeRequest) setResearchLoading(false); });
    return () => { activeRequest = false; };
  }, [holdingsKey]);

  const enriched = useMemo(() => holdings.map((item) => {
    const history = histories[item.symbol];
    const price = Number(history?.snapshot.latest_price) || item.cost;
    const costValue = item.cost * item.quantity;
    const marketValue = price * item.quantity;
    const pnl = marketValue - costValue;
    const gain = costValue ? pnl / costValue : 0;
    return { ...item, asset: assets[item.symbol], history, forecast: forecasts[item.symbol], price, costValue, marketValue, pnl, gain };
  }), [assets, forecasts, histories, holdings]);
  const summary = useMemo(() => enriched.reduce((total, item) => ({ value: total.value + item.marketValue, cost: total.cost + item.costValue, pnl: total.pnl + item.pnl }), { value: 0, cost: 0, pnl: 0 }), [enriched]);
  const analytics = useMemo(() => calculatePortfolioAnalytics(enriched.map((item) => ({ symbol: item.symbol, marketValue: item.marketValue, forecast: item.forecast, history: item.history }))), [enriched]);
  const allocation = useMemo(() => {
    const byType = new Map<string, number>();
    enriched.forEach((item) => byType.set(item.asset?.asset_type || "unknown", (byType.get(item.asset?.asset_type || "unknown") || 0) + item.marketValue));
    return [...byType.entries()].sort((a, b) => b[1] - a[1]);
  }, [enriched]);
  const dataAsOf = [...Object.values(histories).map((item) => item.data_as_of).filter(Boolean)].sort().at(-1) || "—";

  function ensurePortfolio(): Portfolio {
    return active || { id: crypto.randomUUID(), name: zh ? "我的组合" : "My Portfolio", currency: "USD", holdings: [] };
  }
  function addHolding() {
    const normalized = symbol.trim().toUpperCase();
    const qty = Number(quantity); const entry = Number(cost);
    if (!normalized || !(qty > 0) || !(entry >= 0)) return;
    const portfolio = ensurePortfolio();
    const holding: PortfolioHolding = { symbol: normalized, quantity: qty, cost: entry };
    const next = { ...portfolio, holdings: [...portfolio.holdings.filter((item) => item.symbol !== normalized), holding] };
    updateUserState((current) => ({ ...current, portfolios: current.portfolios.length ? current.portfolios.map((item, index) => index === 0 ? next : item) : [next] }));
    setSymbol(""); setQuantity(""); setCost("");
  }
  function removeHolding(target: string) {
    updateUserState((current) => ({ ...current, portfolios: current.portfolios.map((item, index) => index === 0 ? { ...item, holdings: item.holdings.filter((holding) => holding.symbol !== target) } : item) }));
  }
  async function askPortfolio(question = aiDraft) {
    const clean = question.trim();
    const primary = [...enriched].sort((left, right) => right.marketValue - left.marketValue)[0];
    if (!clean || !primary) return;
    setAiError(""); setAiDraft(""); setAiLoading(true);
    const next = [...aiMessages, createChatMessage("user", clean)];
    updateUserState((current) => ({ ...current, portfolio_ai_chat: compactChatThread(next, current.portfolio_ai_chat?.summary) }));
    try {
      const holdingsContext = enriched.slice(0, 8).map((item) => `${item.symbol} ${(analytics.weights[item.symbol] * 100).toFixed(1)}%/1M ${formatPercent(item.forecast?.forecast_1m_return, true)}/conf ${formatMetricPercent(item.forecast?.confidence_score)}`).join("; ");
      const portfolioPrompt = `${zh ? "组合数据" : "Portfolio data"} (${dataAsOf}): ${holdingsContext}. ${zh ? "组合1月预测" : "Portfolio 1M forecast"} ${formatPercent(analytics.expectedReturns["1M"], true)}, ${zh ? "年化波动" : "annualized volatility"} ${formatPercent(analytics.annualizedVolatility)}, ${zh ? "最大回撤" : "max drawdown"} ${formatPercent(analytics.maxDrawdown)}. ${zh ? "问题" : "Question"}: ${clean}`.slice(0, 500);
      const analysis: AiAnalysis = await getAiAnalysis(primary.symbol, language, portfolioPrompt, conversationForApi({ messages: next, summary: userState.portfolio_ai_chat?.summary, updated_at: new Date().toISOString() }));
      const completed = [...next, { ...createChatMessage("assistant", analysis.summary), analysis }];
      updateUserState((current) => ({ ...current, portfolio_ai_chat: compactChatThread(completed, current.portfolio_ai_chat?.summary) }));
    } catch {
      setAiError(zh ? "组合 AI 研究暂时不可用，请稍后重试。" : "Portfolio AI research is temporarily unavailable.");
    } finally { setAiLoading(false); }
  }

  const change = summary.cost ? summary.value / summary.cost - 1 : 0;
  return <main className="page-shell portfolio-page">
    <header className="page-title"><div><h1>{zh ? "组合预测中心" : "Portfolio forecast center"}</h1><p>{zh ? "把持仓盈亏、组合风险和多周期预测放在同一视图" : "Combine P/L, portfolio risk and multi-horizon forecasts"}</p></div><small>{zh ? `数据截至 ${dataAsOf}` : `Data as of ${dataAsOf}`}</small></header>
    <ResearchNavigation />
    <section className="portfolio-summary"><div><small>{zh ? "当前市值" : "Market value"}</small><strong>{formatNumber(summary.value)}</strong></div><div><small>{zh ? "未实现盈亏" : "Unrealized P/L"}</small><strong className={summary.pnl >= 0 ? "positive" : "negative"}>{summary.pnl >= 0 ? "+" : ""}{formatNumber(summary.pnl)}</strong></div><div><small>{zh ? "组合收益率" : "Portfolio return"}</small><strong className={change >= 0 ? "positive" : "negative"}>{formatPercent(change, true)}</strong></div><div><small>{zh ? "未来1月加权预测" : "Weighted 1M forecast"}</small><strong className={Number(analytics.expectedReturns["1M"] || 0) >= 0 ? "positive" : "negative"}>{formatPercent(analytics.expectedReturns["1M"], true)}</strong></div></section>
    {holdings.length ? <section className="portfolio-risk-grid">
      <article><small>{zh ? "组合预测可信度" : "Forecast confidence"}</small><strong>{formatMetricPercent(analytics.confidence)}</strong><span>{zh ? "按当前市值加权" : "Market-value weighted"}</span></article>
      <article><small>{zh ? "历史年化波动率" : "Annualized volatility"}</small><strong>{formatPercent(analytics.annualizedVolatility)}</strong><span>{zh ? "基于近1年日收益" : "Based on 1Y daily returns"}</span></article>
      <article><small>{zh ? "历史最大回撤" : "Historical max drawdown"}</small><strong className="negative">{formatPercent(analytics.maxDrawdown)}</strong><span>{zh ? "固定权重模拟" : "Fixed-weight simulation"}</span></article>
      <article><small>{zh ? "最大单一仓位" : "Largest position"}</small><strong>{formatPercent(analytics.topWeight)}</strong><span>{analytics.topWeight > 0.35 ? (zh ? "存在集中度风险" : "Concentration risk") : (zh ? "集中度可控" : "Concentration controlled")}</span></article>
    </section> : null}
    {allocation.length > 0 && <section className="allocation-panel"><header><strong>{zh ? "资产配置" : "Allocation"}</strong><small>{zh ? "按资产类型估算" : "By asset type"}</small></header><div>{allocation.map(([type, value]) => <article key={type}><span><strong>{localizeAssetType(type, language)}</strong><small>{formatNumber(value)}</small></span><b>{summary.value ? formatPercent(value / summary.value) : "—"}</b></article>)}</div></section>}
    <section className="holding-form"><input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder={zh ? "代码，如 AAPL" : "Symbol, e.g. AAPL"} /><input type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder={zh ? "数量" : "Quantity"} /><input type="number" value={cost} onChange={(event) => setCost(event.target.value)} placeholder={zh ? "平均成本" : "Average cost"} /><button onClick={addHolding}><Plus size={15} />{zh ? "添加持仓" : "Add holding"}</button></section>
    <section className="screener-results"><div className="table-wrap"><table className="mobile-card-table"><thead><tr><th>{zh ? "资产" : "Asset"}</th><th>{zh ? "数量" : "Quantity"}</th><th>{zh ? "现价" : "Price"}</th><th>{zh ? "仓位" : "Weight"}</th><th>1D</th><th>5D</th><th>1M</th><th>{zh ? "可信度" : "Confidence"}</th><th>{zh ? "盈亏" : "P/L"}</th><th /></tr></thead><tbody>{enriched.map((holding) => <tr key={holding.symbol}>
      <td data-label={zh ? "资产" : "Asset"}><Link href={assetPath(holding.symbol)}><strong>{holding.asset ? displayAssetName(holding.asset, language) || holding.symbol : holding.symbol}</strong><br /><small>{holding.symbol}</small></Link></td>
      <td data-label={zh ? "数量" : "Quantity"}>{holding.quantity}</td>
      <td data-label={zh ? "现价" : "Price"}>{formatNumber(holding.price)}</td>
      <td data-label={zh ? "仓位" : "Weight"}>{formatPercent(analytics.weights[holding.symbol])}</td>
      <td data-label="1D">{formatPercent(holding.forecast?.forecast_1d_return, true)}</td>
      <td data-label="5D">{formatPercent(holding.forecast?.forecast_5d_return, true)}</td>
      <td data-label="1M">{formatPercent(holding.forecast?.forecast_1m_return, true)}</td>
      <td data-label={zh ? "可信度" : "Confidence"}>{formatMetricPercent(holding.forecast?.confidence_score)}</td>
      <td data-label={zh ? "盈亏" : "P/L"} className={holding.pnl >= 0 ? "positive" : "negative"}>{holding.pnl >= 0 ? "+" : ""}{formatNumber(holding.pnl)}</td>
      <td data-label={zh ? "操作" : "Action"}><button className="table-action" aria-label={zh ? `删除 ${holding.symbol}` : `Remove ${holding.symbol}`} onClick={() => removeHolding(holding.symbol)}><Trash2 size={14} /></button></td>
    </tr>)}</tbody></table></div>{researchLoading ? <p className="portfolio-loading">{zh ? "正在更新组合行情与预测…" : "Updating portfolio market data and forecasts…"}</p> : null}</section>
    {holdings.length ? <div className="portfolio-analysis-grid">
      <section className="portfolio-panel"><header><strong>{zh ? "相关性矩阵" : "Correlation matrix"}</strong><small>{zh ? "越接近 1，走势越相似" : "Closer to 1 means more similar movement"}</small></header><div className="table-wrap"><table><thead><tr><th />{analytics.correlation.map((row) => <th key={row.symbol}>{row.symbol}</th>)}</tr></thead><tbody>{analytics.correlation.map((row) => <tr key={row.symbol}><th>{row.symbol}</th>{analytics.correlation.map((column) => <td key={column.symbol}>{row.values[column.symbol] === null ? "—" : Number(row.values[column.symbol]).toFixed(2)}</td>)}</tr>)}</tbody></table></div></section>
      <section className="portfolio-panel"><header><strong>{zh ? "压力测试" : "Stress tests"}</strong><small>{zh ? "情景估算，不是损失上限" : "Scenario estimates, not loss limits"}</small></header><div className="stress-list">{analytics.stress.map((item) => <article key={item.id}><span><ShieldAlert size={14} /><b>{stressLabel(item.id, zh)}</b></span><strong className="negative">{formatPercent(item.estimatedReturn, true)}</strong></article>)}</div></section>
    </div> : null}
    {analytics.rebalance.length ? <section className="portfolio-panel rebalance-panel"><header><strong>{zh ? "再平衡复核候选" : "Rebalancing review candidates"}</strong><small>{zh ? "仅用于优先排序，不自动下单" : "Prioritization only; no automatic trading"}</small></header><div>{analytics.rebalance.map((item) => <Link href={assetPath(item.symbol)} key={`${item.symbol}-${item.reason}`}><span><strong>{item.symbol}</strong><small>{rebalanceReason(item.reason, zh)}</small></span><b>{formatPercent(item.weight)}</b></Link>)}</div></section> : null}
    {holdings.length ? <section className="portfolio-ai"><header><span><BrainCircuit size={17} /><span><strong>{zh ? "AI 组合研究助理" : "AI portfolio research assistant"}</strong><small>{zh ? "仅在点击发送后，将当前组合摘要交给 Gemini 分析" : "Portfolio summaries are sent to Gemini only after you submit"}</small></span></span></header><div className="portfolio-ai-messages">{aiMessages.length ? aiMessages.map((message) => <article className={message.role} key={message.id}><small>{message.role === "user" ? (zh ? "你" : "You") : "Orivane AI"}</small><p>{message.content}</p></article>) : <p>{zh ? "可询问集中度、相关性、风险来源、再平衡顺序或某个情景对组合的影响。" : "Ask about concentration, correlations, risk sources, rebalancing priorities or scenario impact."}</p>}</div><nav>{(zh ? ["组合最大的风险来源是什么？", "应该优先复核哪个持仓？", "如何降低集中度但保留上涨敞口？"] : ["What is the portfolio's biggest risk?", "Which holding should I review first?", "How can I reduce concentration while retaining upside exposure?"]).map((question) => <button type="button" key={question} onClick={() => askPortfolio(question)}>{question}</button>)}</nav><form onSubmit={(event) => { event.preventDefault(); void askPortfolio(); }}><input value={aiDraft} onChange={(event) => setAiDraft(event.target.value)} placeholder={zh ? "继续询问组合…" : "Ask about the portfolio…"} /><button disabled={aiLoading || !aiDraft.trim()}><Send size={14} />{aiLoading ? (zh ? "分析中" : "Analyzing") : (zh ? "发送" : "Send")}</button></form>{aiError ? <p className="negative">{aiError}</p> : null}</section> : null}
  </main>;
}

function localizeAssetType(value: string, language: string): string {
  if (language !== "zh") return value === "unknown" ? "Unknown" : value.toUpperCase();
  return ({ stock: "股票", etf: "ETF", index: "指数", fund: "基金", market: "市场", currency: "外汇", unknown: "未知" } as Record<string, string>)[value] || value;
}

function stressLabel(id: "two_sigma" | "concentration" | "forecast_bear", zh: boolean): string {
  return ({ two_sigma: zh ? "月度两倍波动冲击" : "Two-sigma monthly shock", concentration: zh ? "最大持仓下跌 20%" : "Largest holding falls 20%", forecast_bear: zh ? "模型悲观区间" : "Model bear range" } as const)[id];
}

function rebalanceReason(reason: "concentration" | "negative_forecast" | "low_confidence" | "positive_candidate", zh: boolean): string {
  return ({ concentration: zh ? "单一仓位超过 35%，优先复核集中度" : "Single position exceeds 35%; review concentration", negative_forecast: zh ? "1个月模型路径偏弱" : "1M model path is soft", low_confidence: zh ? "预测可信度较低，避免依赖单一结论" : "Low confidence; avoid relying on one signal", positive_candidate: zh ? "正向路径且可信度较高，可研究是否提高权重" : "Positive path with higher confidence; review for a larger weight" } as const)[reason];
}
