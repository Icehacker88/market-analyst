"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { ArrowRight, Bell } from "lucide-react";
import { resolveAssets } from "@/lib/api";
import { assetPath } from "@/lib/asset-catalog";
import { displayAssetName } from "@/lib/assets";
import type { Asset } from "@/lib/types";
import { AppLink as Link } from "./app-link";
import { AssetLogo } from "./asset-logo";
import { useApp } from "./providers";
import s from "./home.module.css";

const placeholder = () => <div className={s.personalPlaceholder} aria-hidden="true" />;
const WatchlistChangeSummary = dynamic(() => import("./watchlist-change-summary").then((m) => m.WatchlistChangeSummary), { ssr: false, loading: placeholder });
const DailyResearchBrief = dynamic(() => import("./daily-research-brief").then((m) => m.DailyResearchBrief), { ssr: false, loading: placeholder });
const ResearchHabitCard = dynamic(() => import("./research-habit-card").then((m) => m.ResearchHabitCard), { ssr: false, loading: placeholder });

export function HomeReturning() {
  const { privateStorage, favorites, language, userState } = useApp();
  const [recents, setRecents] = useState<Asset[]>([]);
  const zh = language === "zh";
  useEffect(() => {
    let cancelled = false;
    try {
      const stored = JSON.parse(privateStorage.getItem("orivane-recent-symbols") || "[]") as unknown;
      const symbols = Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string").slice(0, 4) : [];
      if (symbols.length) void resolveAssets(symbols).then((assets) => { if (!cancelled) setRecents(assets); }).catch(() => undefined);
    } catch { /* No valid recent research on this device. */ }
    return () => { cancelled = true; };
  }, [privateStorage]);
  const assets = [...new Map([...recents, ...favorites].map((asset) => [asset.symbol, asset])).values()].slice(0, 6);
  const alert = userState.alert_history?.[0];
  const hasReviews = Object.keys(userState.research_reviews || {}).length > 0;
  if (!assets.length && !alert && !hasReviews) return null;
  return <div className={s.returning}>
    {(assets.length > 0 || alert) && <section className="returning-home"><header><span><strong>{zh ? "继续研究" : "Continue research"}</strong><small>{zh ? "最近查看与关注资产" : "Recent and followed assets"}</small></span><Link href="/favorites/">{zh ? "自选与跟踪" : "Watchlist"}<ArrowRight size={12} /></Link></header><div className="returning-assets">{assets.map((asset) => <Link key={asset.symbol} href={assetPath(asset.symbol)}><AssetLogo asset={asset} size="small" /><span><strong>{displayAssetName(asset, language)}</strong><small>{asset.symbol}</small></span><ArrowRight size={13} /></Link>)}</div>{alert && <Link className="returning-alert" href={assetPath(alert.symbol)}><Bell size={14} /><span><strong>{zh ? "最近提醒已触发" : "Latest triggered alert"}</strong><small>{alert.symbol} · {new Date(alert.triggered_at).toLocaleString(zh ? "zh-CN" : "en-US")}</small></span><ArrowRight size={13} /></Link>}</section>}
    {assets.length > 0 && <div className={s.personalSlot}><ResearchHabitCard recentAssets={recents} /></div>}
    {hasReviews && <div className={s.personalSlot}><DailyResearchBrief /></div>}
    {favorites.length > 0 && <div className={s.personalSlot}><WatchlistChangeSummary /></div>}
  </div>;
}
