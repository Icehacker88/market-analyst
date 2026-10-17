"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Bell, MoreHorizontal, Plus, Search, X } from "lucide-react";
import { assetPath } from "@/lib/asset-catalog";
import { displayAssetName } from "@/lib/assets";
import { addComparisonDraft, dashboardDestination } from "@/lib/dashboard-state";
import { assetTypeLabels } from "@/lib/home-discovery";
import { filterBySearchGroup, searchGroups, type SearchGroup } from "@/lib/search-groups";
import type { Asset } from "@/lib/types";
import { AssetLogo } from "./asset-logo";
import { useApp } from "./providers";
import { useAssetSearch } from "./use-asset-search";
import s from "./home.module.css";

export function HomeSearch() {
  const { language, privateStorage } = useApp();
  const zh = language === "zh";
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<SearchGroup>("all");
  const [active, setActive] = useState(0);
  const [more, setMore] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const gridId = `${id}-results`;
  const { results, remoteLoading, remoteComplete, error } = useAssetSearch(query, 180, true);
  const rows = filterBySearchGroup(results, group).slice(0, 20);
  const groups = searchGroups(results, language);
  const expanded = open && Boolean(query.trim());
  const selected = rows.length ? Math.min(active, rows.length - 1) : -1;
  const rowId = (index: number) => `${id}-row-${index}`;

  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setMore(null); } };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useEffect(() => {
    if (expanded && selected >= 0) document.getElementById(rowId(selected))?.scrollIntoView?.({ block: "nearest" });
    // Keyboard selection and expanded actions stay visible; hover is CSS-only.
  }, [expanded, selected, id, more]);
  useEffect(() => {
    if (!expanded) return;
    const viewport = window.visualViewport;
    const measure = () => {
      if (!root.current) return;
      const bounds = root.current.getBoundingClientRect();
      const available = (viewport?.height || window.innerHeight) - Math.max(0, bounds.bottom - (viewport?.offsetTop || 0));
      root.current.style.setProperty("--results-height", `${Math.max(120, available - (window.innerWidth <= 960 ? 88 : 24))}px`);
    };
    measure();
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => { viewport?.removeEventListener("resize", measure); viewport?.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure); };
  }, [expanded]);

  const navigate = (asset: Asset) => { setOpen(false); setMore(null); router.push(assetPath(asset.symbol)); };
  function compare(asset: Asset) {
    let seed: string[] = [];
    try {
      const recent = JSON.parse(privateStorage.getItem("orivane-recent-symbols") || "[]") as unknown;
      if (Array.isArray(recent) && typeof recent[0] === "string" && recent[0] !== asset.symbol) seed = [recent[0]];
    } catch { /* A comparison can start with the selected asset. */ }
    const symbols = addComparisonDraft(privateStorage, asset.symbol, seed);
    setOpen(false);
    router.push(dashboardDestination(symbols, { active: asset.symbol, range: "1Y", normalized: true, isolated: null, tab: "priceReturn" }));
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { setOpen(false); setMore(null); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setOpen(true); setMore(null);
      setActive(rows.length ? !expanded ? (event.key === "ArrowDown" ? 0 : rows.length - 1) : (selected + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length : 0);
    }
    if (event.key === "Enter" && rows[selected]) { event.preventDefault(); navigate(rows[selected]); }
  }
  const status = error ? (zh ? "网络补充失败；本地结果仍可使用。" : "Cloud enrichment failed; local results remain available.")
    : remoteLoading || (!remoteComplete && !rows.length) ? (zh ? "正在补充搜索结果…" : "Loading more search results…")
      : !rows.length ? (zh ? "没有匹配资产，请尝试代码或公司名。" : "No matching assets. Try a symbol or company name.")
        : (zh ? `${rows.length} 条结果，方向键选择，回车查看研究。` : `${rows.length} results. Arrow keys to choose, Enter to research.`);
  return <div className={s.search} ref={root} onKeyDownCapture={(event) => {
    if (event.key !== "Escape" || !more || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    const index = rows.findIndex((asset) => asset.symbol === more);
    setMore(null);
    if (index >= 0) document.getElementById(`${id}-more-${index}`)?.focus();
  }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setMore(null); } }}>
    <label className={s.searchLabel} htmlFor={`${id}-input`}>{zh ? "搜索资产，开始研究" : "Search an asset to start researching"}</label>
    <div className={s.searchInput}><Search size={21} aria-hidden="true" /><input id={`${id}-input`} ref={input} role="combobox" aria-label={zh ? "搜索资产" : "Search assets"} aria-haspopup="grid" aria-expanded={expanded} aria-controls={expanded ? gridId : undefined} aria-activedescendant={expanded && selected >= 0 ? rowId(selected) : undefined} aria-autocomplete="list" autoComplete="off" autoCapitalize="off" spellCheck={false} value={query} placeholder={zh ? "股票 / ETF / 基金名称或代码" : "Stock / ETF / fund name or symbol"} onKeyDown={onKeyDown} onFocus={() => query.trim() && setOpen(true)} onChange={(event) => { setQuery(event.target.value); setGroup("all"); setActive(0); setMore(null); setOpen(Boolean(event.target.value.trim())); }} />{query && <button type="button" aria-label={zh ? "清空搜索" : "Clear search"} onClick={() => { setQuery(""); setOpen(false); setMore(null); input.current?.focus(); }}><X size={17} /></button>}</div>
    {expanded && <div className={s.searchPopover}>
      {groups.length > 2 && <div className={s.searchGroups} role="group" aria-label={zh ? "资产类型筛选" : "Filter asset type"}>{groups.map((item) => <button type="button" key={item.key} aria-pressed={group === item.key} onClick={() => { setGroup(item.key); setActive(0); setMore(null); input.current?.focus(); }}>{item.label} <small>{item.count}</small></button>)}</div>}
      <div className={s.resultScroll} role="grid" id={gridId} aria-label={zh ? "资产搜索结果" : "Asset search results"}>
        {rows.map((asset, index) => <div className={s.resultRow} role="row" aria-selected={selected === index} id={rowId(index)} key={asset.symbol}>
          <div role="gridcell" className={s.resultCell}><button type="button" className={s.resultMain} onClick={() => navigate(asset)}><AssetLogo asset={asset} size="small" /><span><strong>{displayAssetName(asset, language) || asset.symbol}</strong><small>{asset.symbol} · {asset.exchange || asset.data_source}</small><span className={s.badges}>{assetTypeLabels(asset, language).map((label) => <em key={label}>{label}</em>)}</span></span></button></div>
          <div role="gridcell" className={s.moreCell}><button type="button" id={`${id}-more-${index}`} aria-label={`${zh ? "更多操作" : "More actions"} ${asset.symbol}`} aria-expanded={more === asset.symbol} aria-controls={more === asset.symbol ? `${id}-actions-${index}` : undefined} onClick={() => { setActive(index); setMore(more === asset.symbol ? null : asset.symbol); }}><MoreHorizontal size={19} /></button></div>
          {more === asset.symbol && <div role="gridcell" className={s.moreActions} id={`${id}-actions-${index}`}><button type="button" onClick={() => compare(asset)}><Plus size={14} />{zh ? "加入对比" : "Compare"}</button><button type="button" onClick={() => { setOpen(false); router.push(`/favorites/?alert=${encodeURIComponent(asset.symbol)}`); }}><Bell size={14} />{zh ? "设置提醒" : "Set alert"}</button></div>}
        </div>)}
      </div>
      <p className={`${s.searchStatus} ${error ? s.warning : ""}`} role="status" aria-live="polite" aria-atomic="true">{status}</p>
    </div>}
  </div>;
}
