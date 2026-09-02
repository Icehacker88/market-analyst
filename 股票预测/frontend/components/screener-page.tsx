"use client";

import { AppLink as Link } from "./app-link";
import { ArrowDown, ArrowUp, BookmarkPlus, Filter, Info, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getScreener, searchAssets } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import { assetPath } from "@/lib/asset-catalog";
import { displayAssetName } from "@/lib/assets";
import { formatNumber, formatPercent } from "@/lib/format";
import { localizeSignal } from "@/lib/i18n";
import { hasNumericField, sortScreenerRows, type ScreenerSortDirection, type ScreenerSortKey } from "@/lib/screener";
import { matchesScreenerMarket, matchesScreenerTheme, parseScreenerQuery, type ScreenerMarket } from "@/lib/screener-query";
import type { Asset, ScreenerRow } from "@/lib/types";
import { AssetLogo } from "./asset-logo";
import { useApp } from "./providers";
import { ResearchNavigation } from "./research-navigation";
import { LoadingState } from "./states";

export function ScreenerPage() {
  const { language, updateUserState, userState } = useApp();
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [searchResults, setSearchResults] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [naturalQuery, setNaturalQuery] = useState("");
  const [parsedLabels, setParsedLabels] = useState<string[]>([]);
  const [market, setMarket] = useState<ScreenerMarket>("all");
  const [theme, setTheme] = useState("");
  const [sector, setSector] = useState("all");
  const [signal, setSignal] = useState("all");
  const [minReturn, setMinReturn] = useState("");
  const [maxPe, setMaxPe] = useState("");
  const [maxVolatility, setMaxVolatility] = useState("");
  const [sortKey, setSortKey] = useState<ScreenerSortKey>("return_1y");
  const [sortDirection, setSortDirection] = useState<ScreenerSortDirection>("desc");
  useEffect(() => { getScreener().then(setRows).catch(() => setRows([])).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    const term = query.trim();
    if (!term) { setSearchResults([]); setSearching(false); return; }
    const timer = setTimeout(() => {
      setSearching(true);
      searchAssets(term).then(setSearchResults).catch(() => setSearchResults([])).finally(() => setSearching(false));
    }, 280);
    return () => clearTimeout(timer);
  }, [query]);
  const mergedRows = useMemo(() => {
    const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
    searchResults.forEach((asset) => {
      if (!bySymbol.has(asset.symbol)) bySymbol.set(asset.symbol, assetToScreenerRow(asset));
    });
    return [...bySymbol.values()];
  }, [rows, searchResults]);
  const hasPeData = useMemo(() => hasNumericField(mergedRows, "pe_ratio"), [mergedRows]);
  const hasMarketCapData = useMemo(() => hasNumericField(mergedRows, "market_cap"), [mergedRows]);
  const filtered = useMemo(() => sortScreenerRows(mergedRows.filter((row) => {
    if (query && !searchText(row, language).includes(query.toLowerCase())) return false;
    if (!matchesScreenerMarket(row.symbol, market)) return false;
    if (!matchesScreenerTheme(row, theme)) return false;
    if (sector !== "all" && row.sector !== sector) return false;
    if (signal !== "all" && row.signal !== signal) return false;
    if (minReturn && (row.return_1y ?? -Infinity) < Number(minReturn) / 100) return false;
    if (hasPeData && maxPe && (row.pe_ratio === null || row.pe_ratio > Number(maxPe))) return false;
    if (maxVolatility && (row.volatility_20d ?? Infinity) > Number(maxVolatility) / 100) return false;
    return true;
  }), sortKey, sortDirection), [hasPeData, language, market, maxPe, maxVolatility, minReturn, query, mergedRows, sector, signal, sortDirection, sortKey, theme]);
  const zh = language === "zh";
  function saveFilters() {
    const name = zh ? `筛选 ${userState.savedScreeners.length + 1}` : `Screen ${userState.savedScreeners.length + 1}`;
    updateUserState((current) => ({ ...current, savedScreeners: [...current.savedScreeners, { id: crypto.randomUUID(), name, filters: { query, naturalQuery, market, theme, sector, signal, minReturn, maxPe, maxVolatility, sortKey, sortDirection } }] }));
    trackEvent("screener_save");
  }
  function applyFilters(filters: Record<string, string | number>) {
    setQuery(String(filters.query || ""));
    setNaturalQuery(String(filters.naturalQuery || ""));
    setMarket(isMarket(filters.market) ? filters.market : "all");
    setTheme(String(filters.theme || ""));
    setSector(String(filters.sector || "all"));
    setSignal(String(filters.signal || "all"));
    setMinReturn(String(filters.minReturn || ""));
    setMaxPe(String(filters.maxPe || ""));
    setMaxVolatility(String(filters.maxVolatility || ""));
    if (isSortKey(filters.sortKey)) setSortKey(filters.sortKey);
    if (filters.sortDirection === "asc" || filters.sortDirection === "desc") setSortDirection(filters.sortDirection);
    setParsedLabels(String(filters.naturalQuery || "") ? parseScreenerQuery(String(filters.naturalQuery)).labels : []);
  }
  function applyNaturalQuery(value = naturalQuery) {
    const parsed = parseScreenerQuery(value);
    setMarket(parsed.market);
    setTheme(parsed.theme);
    setSector(parsed.sector);
    setSignal(parsed.signal);
    setMinReturn(parsed.minReturn);
    setMaxPe(parsed.maxPe);
    setMaxVolatility(parsed.maxVolatility);
    setSortKey(parsed.sortKey);
    setSortDirection(parsed.sortDirection);
    setParsedLabels(parsed.labels);
    trackEvent("screener_natural_query");
  }
  return <main className="page-shell screener-page"><header className="page-title"><div><h1>{zh ? "选股器" : "Stock screener"}</h1><p>{zh ? "按趋势、行业与风险发现资产" : "Discover assets by momentum, sector and risk"}</p></div><button className="primary-link" onClick={saveFilters}><BookmarkPlus size={15} />{zh ? "保存条件" : "Save filters"}</button></header>
    <ResearchNavigation />
    <section className="natural-screener"><header><span><Sparkles size={15} /><strong>{zh ? "自然语言选股" : "Natural-language screen"}</strong></span><small>{zh ? "输入一句话，自动转换为可核对的筛选条件" : "Describe a screen and review the generated filters"}</small></header><div><input value={naturalQuery} onChange={(event) => setNaturalQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyNaturalQuery(); }} placeholder={zh ? "例如：美股半导体，一年涨幅超过 50%，波动率低于 40%" : "e.g. US semiconductors, 1Y return above 50%, volatility below 40%"} /><button type="button" onClick={() => applyNaturalQuery()}><Sparkles size={14} />{zh ? "生成筛选" : "Apply"}</button></div>{parsedLabels.length ? <p>{parsedLabels.map((label) => <span key={label}>{label}</span>)}</p> : null}<nav>{(zh ? ["A股低波动，看涨", "美股半导体，一年涨幅超过50%", "港股互联网，波动率低于45%"] : ["Bullish low-volatility A shares", "US semiconductors, 1Y return above 50%", "Hong Kong internet, volatility below 45%"]).map((example) => <button type="button" key={example} onClick={() => { setNaturalQuery(example); applyNaturalQuery(example); }}>{example}</button>)}</nav></section>
    <section className={`screener-filters ${hasPeData ? "" : "valuation-unavailable"}`}><label className="filter-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "代码、中文名或拼音" : "Symbol, name or pinyin"} /></label><label><span>{zh ? "市场" : "Market"}</span><select value={market} onChange={(event) => setMarket(event.target.value as ScreenerMarket)}><option value="all">{zh ? "全部" : "All"}</option><option value="a">A 股</option><option value="hk">{zh ? "港股" : "Hong Kong"}</option><option value="us">{zh ? "美股" : "US"}</option></select></label><label><span>{zh ? "行业" : "Sector"}</span><select value={sector} onChange={(event) => setSector(event.target.value)}><option value="all">{zh ? "全部" : "All"}</option>{[...new Set(mergedRows.map((row) => row.sector))].sort().map((item) => <option key={item} value={item}>{localizeSector(item, language)}</option>)}</select></label><label><span>{zh ? "信号" : "Signal"}</span><select value={signal} onChange={(event) => setSignal(event.target.value)}><option value="all">{zh ? "全部" : "All"}</option><option value="Up">{localizeSignal("Up", language)}</option><option value="Down">{localizeSignal("Down", language)}</option><option value="Observe">{localizeSignal("Observe", language)}</option></select></label><label><span>{zh ? "1 年涨幅不低于" : "Min 1Y return"}</span><input type="number" value={minReturn} onChange={(event) => setMinReturn(event.target.value)} placeholder="%" /></label>{hasPeData && <label><span>{zh ? "市盈率不高于" : "Max P/E"}</span><input type="number" value={maxPe} onChange={(event) => setMaxPe(event.target.value)} /></label>}<label><span>{zh ? "波动率不高于" : "Max volatility"}</span><input type="number" value={maxVolatility} onChange={(event) => setMaxVolatility(event.target.value)} placeholder="%" /></label></section>
    {!loading && !hasPeData && !hasMarketCapData && <p className="screener-data-note"><Info size={13} />{zh ? "免费行情暂未稳定提供批量估值数据，相关筛选已自动隐藏。" : "Batch valuation data is not reliably available from the free feed, so those filters are hidden."}</p>}
    {userState.savedScreeners.length > 0 && <section className="saved-screeners"><strong>{zh ? "已保存条件" : "Saved filters"}</strong>{userState.savedScreeners.map((item) => <button key={item.id} onClick={() => applyFilters(item.filters)}>{item.name}</button>)}</section>}
    <section className="screener-results"><header><span><Filter size={14} />{filtered.length} {zh ? "个结果" : "results"}{searching ? <small>{zh ? "搜索中" : "searching"}</small> : null}</span><div className="screener-sort"><label><span className="sr-only">{zh ? "排序方式" : "Sort by"}</span><select value={sortKey} onChange={(event) => setSortKey(event.target.value as ScreenerSortKey)}><option value="return_1y">{zh ? "近 1 年涨幅" : "1Y return"}</option><option value="return_3m">{zh ? "近 3 月涨幅" : "3M return"}</option><option value="return_1d">{zh ? "今日涨跌" : "1D return"}</option><option value="volatility_20d">{zh ? "20 日波动率" : "20D volatility"}</option><option value="latest_price">{zh ? "最新价格" : "Latest price"}</option></select></label><button type="button" onClick={() => setSortDirection((current) => current === "desc" ? "asc" : "desc")} aria-label={sortDirection === "desc" ? (zh ? "当前降序，切换为升序" : "Descending, switch to ascending") : (zh ? "当前升序，切换为降序" : "Ascending, switch to descending")}>{sortDirection === "desc" ? <ArrowDown size={14} /> : <ArrowUp size={14} />}</button></div></header>{loading ? <LoadingState /> : <div className="table-wrap"><table><thead><tr><th>{zh ? "资产" : "Asset"}</th><th>{zh ? "行业" : "Sector"}</th><th>{zh ? "价格" : "Price"}</th><th>1D</th><th>3M</th><th>1Y</th>{hasPeData && <th>{zh ? "市盈率" : "P/E"}</th>}{hasMarketCapData && <th>{zh ? "市值" : "Market cap"}</th>}<th>{zh ? "波动率" : "Volatility"}</th><th>{zh ? "信号" : "Signal"}</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.symbol}><td><Link className="asset-table-link" href={assetPath(row.symbol)}><AssetLogo asset={row} size="small" /><span><strong>{displayAssetName(row, language) || row.symbol}</strong><small>{row.symbol}</small></span></Link></td><td>{localizeSector(row.sector, language)}</td><td>{formatNumber(row.latest_price)}</td><td className={(row.return_1d ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(row.return_1d, true)}</td><td className={(row.return_3m ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(row.return_3m, true)}</td><td className={(row.return_1y ?? 0) >= 0 ? "positive" : "negative"}>{formatPercent(row.return_1y, true)}</td>{hasPeData && <td>{formatNumber(row.pe_ratio)}</td>}{hasMarketCapData && <td>{row.market_cap ? Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(row.market_cap) : "—"}</td>}<td>{formatPercent(row.volatility_20d)}</td><td>{localizeSignal(row.signal, language)}</td></tr>)}</tbody></table></div>}</section>
  </main>;
}

function assetToScreenerRow(asset: Asset): ScreenerRow {
  return {
    ...asset,
    sector: asset.asset_type === "fund" ? "Funds" : /\.(SH|SZ|BJ)$/i.test(asset.symbol) ? "A Shares" : "Search result",
    latest_price: null,
    return_1d: null,
    return_3m: null,
    return_1y: null,
    volatility_20d: null,
    market_cap: null,
    pe_ratio: null,
    signal: "Observe",
    confidence: null,
  };
}

function searchText(row: ScreenerRow, language: string): string {
  return [row.symbol, row.name, row.name_en, row.name_zh, row.name_pinyin, displayAssetName(row, language as "zh" | "en")].join(" ").toLowerCase();
}

function localizeSector(value: string, language: string): string {
  if (language !== "zh") return value;
  return ({
    Technology: "科技",
    Consumer: "消费",
    Communication: "通信",
    Financial: "金融",
    Healthcare: "医疗健康",
    Industrials: "工业",
    Diversified: "多元资产",
    Other: "其他",
    Funds: "基金",
    "A Shares": "A 股",
    "Search result": "搜索结果",
  } as Record<string, string>)[value] || value;
}

function isSortKey(value: string | number): value is ScreenerSortKey {
  return ["return_1y", "return_3m", "return_1d", "volatility_20d", "latest_price"].includes(String(value));
}

function isMarket(value: string | number): value is ScreenerMarket {
  return ["all", "us", "a", "hk"].includes(String(value));
}
