"use client";

import { ArrowRight, BellRing } from "lucide-react";
import { AppLink as Link } from "./app-link";
import { useEffect, useRef, useState } from "react";
import { getForecast } from "@/lib/api";
import { assetPath } from "@/lib/asset-catalog";
import { displayAssetName } from "@/lib/assets";
import { formatNumber, formatPercent } from "@/lib/format";
import type { Asset, Forecast, UserState } from "@/lib/types";
import { useApp } from "./providers";

type Snapshot = NonNullable<UserState["forecast_snapshots"]>[string];
type Change = { asset: Asset; previous: Snapshot; current: Snapshot; forecast: Forecast };

const VISIT_SNAPSHOT_KEY = "orivane-last-visit-forecasts-v1";

function readSnapshots(): Record<string, Snapshot> {
  try { return JSON.parse(localStorage.getItem(VISIT_SNAPSHOT_KEY) || "{}") as Record<string, Snapshot>; } catch { return {}; }
}

function important(previous: Snapshot, current: Snapshot): boolean {
  if (previous.signal !== current.signal) return true;
  if (previous.confidence !== null && current.confidence !== null && Math.abs(current.confidence - previous.confidence) >= 3) return true;
  if (previous.invalidation && current.invalidation && Math.abs(current.invalidation / previous.invalidation - 1) >= 0.01) return true;
  if (current.price && current.invalidation) {
    if (current.signal === "Up" && current.price <= current.invalidation) return true;
    if (current.signal === "Down" && current.price >= current.invalidation) return true;
  }
  return previous.data_as_of !== current.data_as_of;
}

export function WatchlistChangeSummary() {
  const { favorites, language } = useApp();
  const zh = language === "zh";
  const [changes, setChanges] = useState<Change[]>([]);
  const [ready, setReady] = useState(false);
  const [hasBaseline, setHasBaseline] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const loaded = useRef("");
  const sectionRef = useRef<HTMLElement>(null);
  const key = favorites.slice(0, 6).map((asset) => asset.symbol).join(",");

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !favorites.length) return;
    if (!("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: "300px" });
    observer.observe(section);
    return () => observer.disconnect();
  }, [favorites.length]);

  useEffect(() => {
    if (!shouldLoad || !key || loaded.current === key) return;
    loaded.current = key;
    const previous = readSnapshots();
    setHasBaseline(Object.keys(previous).length > 0);
    const timer = window.setTimeout(() => Promise.allSettled(favorites.slice(0, 6).map(async (asset) => ({ asset, forecast: await getForecast(asset.symbol) }))).then((settled) => {
      const next = { ...previous };
      const changed: Change[] = [];
      settled.forEach((result) => {
        if (result.status !== "fulfilled") return;
        const { asset, forecast } = result.value;
        const current: Snapshot = {
          signal: forecast.signal,
          confidence: typeof forecast.confidence_score === "number" ? forecast.confidence_score : null,
          invalidation: typeof forecast.key_levels?.invalidation === "number" ? forecast.key_levels.invalidation : null,
          data_as_of: forecast.data_as_of,
          price: typeof forecast.base_price === "number" ? forecast.base_price : null,
        };
        if (previous[asset.symbol] && important(previous[asset.symbol], current)) changed.push({ asset, previous: previous[asset.symbol], current, forecast });
        next[asset.symbol] = current;
      });
      localStorage.setItem(VISIT_SNAPSHOT_KEY, JSON.stringify(next));
      setChanges(changed);
      setReady(true);
    }), 250);
    return () => window.clearTimeout(timer);
  }, [favorites, key, shouldLoad]);

  if (!favorites.length) return null;
  return <section className="visit-changes" ref={sectionRef}>
    <header><span><BellRing size={15} /><strong>{zh ? "自上次访问后的变化" : "Changes since your last visit"}</strong></span><Link href="/favorites/">{zh ? "管理观察列表" : "Manage watchlist"}<ArrowRight size={12} /></Link></header>
    {!ready ? <p>{zh ? "正在检查收藏资产的最新预测…" : "Checking the latest forecasts for saved assets…"}</p> : !hasBaseline ? <p>{zh ? "已建立本次访问基准；下次打开时会显示方向、可信度和失效位变化。" : "A baseline is now saved. Direction, confidence and invalidation changes will appear next time."}</p> : changes.length ? <div>{changes.slice(0, 6).map((change) => <Link href={assetPath(change.asset.symbol)} key={change.asset.symbol}><span><strong>{displayAssetName(change.asset, language) || change.asset.symbol}</strong><small>{change.asset.symbol} · {change.current.data_as_of}</small></span><p>{describeChange(change, language)}</p><ArrowRight size={13} /></Link>)}</div> : <p>{zh ? "收藏资产暂无重要预测变化。" : "No material forecast changes across saved assets."}</p>}
  </section>;
}

function describeChange(change: Change, language: "zh" | "en"): string {
  const zh = language === "zh";
  const parts: string[] = [];
  if (change.previous.signal !== change.current.signal) parts.push(zh ? `方向 ${signalName(change.previous.signal, true)} → ${signalName(change.current.signal, true)}` : `Signal ${signalName(change.previous.signal, false)} → ${signalName(change.current.signal, false)}`);
  if (change.previous.confidence !== null && change.current.confidence !== null && Math.abs(change.current.confidence - change.previous.confidence) >= 3) parts.push(zh ? `可信度 ${Math.round(change.previous.confidence)} → ${Math.round(change.current.confidence)}` : `Confidence ${Math.round(change.previous.confidence)} → ${Math.round(change.current.confidence)}`);
  if (change.previous.invalidation && change.current.invalidation && Math.abs(change.current.invalidation / change.previous.invalidation - 1) >= 0.01) parts.push(zh ? `失效位调整至 ${formatNumber(change.current.invalidation)}` : `Invalidation moved to ${formatNumber(change.current.invalidation)}`);
  if (!parts.length) parts.push(zh ? `新预测：1个月 ${formatPercent(change.forecast.forecast_1m_return, true)}` : `New forecast: 1M ${formatPercent(change.forecast.forecast_1m_return, true)}`);
  return parts.join(" · ");
}

function signalName(signal: string, zh: boolean): string {
  if (signal === "Up") return zh ? "偏多" : "Up";
  if (signal === "Down") return zh ? "偏空" : "Down";
  return zh ? "观察" : "Observe";
}
