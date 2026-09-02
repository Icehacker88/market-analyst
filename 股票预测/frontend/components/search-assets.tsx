"use client";

import { Bell, ExternalLink, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { trackEvent } from "@/lib/analytics";
import { displayAssetName } from "@/lib/assets";
import { localizeAssetType, localizeSource } from "@/lib/i18n";
import { filterBySearchGroup, searchGroups, type SearchGroup } from "@/lib/search-groups";
import type { Asset } from "@/lib/types";
import { AssetLogo } from "./asset-logo";
import { useApp } from "./providers";
import { SearchField } from "./search-field";
import { Skeleton } from "./states";
import { useAssetSearch } from "./use-asset-search";

export function SearchAssets({
  selected,
  onAdd,
  onOpen,
  onAlert,
  onRemove,
  onClear,
  limitReached,
}: {
  selected: Asset[];
  onAdd: (asset: Asset) => void;
  onOpen: (asset: Asset) => void;
  onAlert: (asset: Asset) => void;
  onRemove: (symbol: string) => void;
  onClear: () => void;
  limitReached: boolean;
}) {
  const { language, t } = useApp();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<SearchGroup>("all");
  const [activeResult, setActiveResult] = useState(0);
  const searchRef = useRef<HTMLDivElement>(null);
  const { results, remoteLoading, remoteComplete, error: searchError } = useAssetSearch(query);

  useEffect(() => {
    function closeOnOutsideClick(event: PointerEvent) {
      if (!searchRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  const visibleResults = filterBySearchGroup(results, group);
  const shownResults = visibleResults.slice(0, 30);
  const groups = searchGroups(results, language);
  useEffect(() => { setActiveResult(0); }, [group, query]);

  function choose(asset: Asset) {
    if (selected.some((item) => item.symbol === asset.symbol) || limitReached) return;
    trackEvent("search");
    onAdd(asset);
    setQuery("");
    setOpen(false);
  }

  function searchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { setOpen(false); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveResult((current) => shownResults.length ? (current + (event.key === "ArrowDown" ? 1 : -1) + shownResults.length) % shownResults.length : 0);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const asset = shownResults[activeResult];
      if (asset) choose(asset);
    }
  }

  return (
    <section className="selection-bar">
      <div className="search-wrap" ref={searchRef}>
        <Search size={17} />
        <SearchField value={query} placeholder={t("search")} label={t("search")} controls="analysis-asset-results" expanded={open} activeDescendant={shownResults[activeResult] ? `analysis-result-${shownResults[activeResult].symbol.replace(/[^a-z0-9]/gi, "-")}` : undefined} onKeyDown={searchKeyDown} onFocus={() => query.trim() && setOpen(true)} onChange={(value) => { setQuery(value); setGroup("all"); setOpen(Boolean(value.trim())); }} />
        {open && query.trim() && <div className="search-results" id="analysis-asset-results" role="listbox">
          {groups.length > 2 && <div className="search-tabs">{groups.map((item) => <button key={item.key} className={item.key === group ? "active" : ""} onClick={() => setGroup(item.key)}>{item.label}<small>{item.count}</small></button>)}</div>}
          {!shownResults.length && remoteLoading ? <Skeleton rows={3} /> : shownResults.map((asset, index) => {
            const chosen = selected.some((item) => item.symbol === asset.symbol);
            return <div className={`search-result-row ${index === activeResult ? "active" : ""}`} key={asset.symbol} onMouseEnter={() => setActiveResult(index)}>
              <button id={`analysis-result-${asset.symbol.replace(/[^a-z0-9]/gi, "-")}`} className="search-result-main" role="option" aria-selected={index === activeResult} disabled={chosen || limitReached} onClick={() => choose(asset)}>
                <AssetLogo asset={asset} size="small" /><span><strong>{displayAssetName(asset, language) || asset.symbol}</strong><small>{asset.symbol}</small></span>
                <em>{localizeAssetType(asset.asset_type, language)} · {localizeSource(asset.data_source, language)}</em>
              </button>
              <div className="search-result-actions"><button onClick={() => choose(asset)} disabled={chosen || limitReached} title={language === "zh" ? "加入对比" : "Add to comparison"} aria-label={language === "zh" ? `将 ${asset.symbol} 加入对比` : `Add ${asset.symbol} to comparison`}><Plus size={13} /></button><button onClick={() => onOpen(asset)} title={language === "zh" ? "打开详情" : "Open details"} aria-label={language === "zh" ? `打开 ${asset.symbol}` : `Open ${asset.symbol}`}><ExternalLink size={13} /></button><button onClick={() => onAlert(asset)} title={language === "zh" ? "设置提醒" : "Set alert"} aria-label={language === "zh" ? `为 ${asset.symbol} 设置提醒` : `Set alert for ${asset.symbol}`}><Bell size={13} /></button></div>
            </div>;
          })}
          <p className={`search-status ${searchError ? "error" : ""}`}>{searchError ? (language === "zh" ? "网络补充暂不可用，已显示本地结果。" : "Cloud enrichment unavailable; local results are shown.") : remoteLoading ? (language === "zh" ? "已显示本地结果，正在补充网络结果…" : "Local results shown; enriching from the cloud…") : !shownResults.length && remoteComplete ? (language === "zh" ? "没有找到匹配资产，请尝试代码、公司名或行业词。" : "No matches. Try a symbol, company name or industry.") : (language === "zh" ? "方向键选择，回车加入对比。" : "Use arrow keys and Enter to compare.")}</p>
        </div>}
      </div>
      <div className="selected-list">
        {selected.map((asset) => <span className="asset-chip" key={asset.symbol}>{displayAssetName(asset, language) || asset.symbol}<small>{asset.symbol}</small><button onClick={() => onRemove(asset.symbol)} aria-label={`${language === "zh" ? "移出对比" : "Remove from comparison"} ${asset.symbol}`}><X size={13} /></button></span>)}
        {selected.length > 0 && <button className="clear-button" onClick={onClear}>{t("clear")}</button>}
      </div>
      {limitReached && <p className="limit-message">{t("maximum")}</p>}
    </section>
  );
}
