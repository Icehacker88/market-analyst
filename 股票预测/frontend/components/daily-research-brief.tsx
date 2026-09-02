"use client";

import { ArrowRight, BellRing, CalendarCheck, CheckCircle2, Clock3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { resolveAssets } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import { assetPath } from "@/lib/asset-catalog";
import { displayAssetName } from "@/lib/assets";
import { formatNumber } from "@/lib/format";
import { recordReviewCompletion } from "@/lib/research-habit";
import { reviewIsDue, reviewReasonLabel } from "@/lib/research-review";
import type { Asset, ResearchReview } from "@/lib/types";
import { AppLink as Link } from "./app-link";
import { AssetLogo } from "./asset-logo";
import { useApp } from "./providers";
import { useAuth } from "./auth-provider";

type ReviewItem = { review: ResearchReview; asset?: Asset };

export function DailyResearchBrief() {
  const { language, updateUserState, userState } = useApp();
  const { user } = useAuth();
  const zh = language === "zh";
  const reviews = useMemo(() => Object.values(userState.research_reviews || {}).sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()), [userState.research_reviews]);
  const [assets, setAssets] = useState<Record<string, Asset>>({});

  useEffect(() => {
    const symbols = reviews.map((review) => review.symbol);
    if (!symbols.length) { setAssets({}); return; }
    resolveAssets(symbols).then((resolved) => setAssets(Object.fromEntries(resolved.map((asset) => [asset.symbol, asset])))).catch(() => undefined);
  }, [reviews]);

  if (!reviews.length) return null;
  const items: ReviewItem[] = reviews.slice(0, 5).map((review) => ({ review, asset: assets[review.symbol] }));
  const due = reviews.filter((review) => reviewIsDue(review)).length;
  const next = reviews[0];
  const remove = (symbol: string) => {
    recordReviewCompletion(localStorage);
    window.dispatchEvent(new Event("orivane-research-habit"));
    trackEvent("research_review_complete");
    updateUserState((current) => {
      const remaining = { ...(current.research_reviews || {}) };
      delete remaining[symbol];
      return { ...current, research_reviews: remaining };
    });
  };

  return <section className="daily-research-brief">
    <header><span><CalendarCheck size={16} /><span><strong>{zh ? "今日研究清单" : "Today’s research queue"}</strong><small>{due ? (zh ? `${due} 项已到复核时间` : `${due} reviews are due`) : (zh ? `下一项 ${new Date(next.due_at).toLocaleDateString("zh-CN")}` : `Next review ${new Date(next.due_at).toLocaleDateString("en-US")}`)} · {user ? (zh ? "已同步" : "Synced") : (zh ? "保存在本机" : "Saved locally")}</small></span></span><Link href="/favorites/">{zh ? "管理研究" : "Manage research"}<ArrowRight size={12} /></Link></header>
    <div>{items.map(({ review, asset }) => {
      const isDue = reviewIsDue(review);
      return <article key={review.symbol} className={isDue ? "due" : "scheduled"}>
        <Link href={assetPath(review.symbol)}>
          {asset ? <AssetLogo asset={asset} size="small" /> : <span className="research-symbol-fallback">{review.symbol.slice(0, 2)}</span>}
          <span><strong>{asset ? displayAssetName(asset, language) : review.symbol}</strong><small>{reviewReasonLabel(review.reason, language)}{review.trigger_price ? ` · ${formatNumber(review.trigger_price)}` : ""}</small></span>
          <em>{isDue ? <><BellRing size={12} />{zh ? "现在复核" : "Review now"}</> : <><Clock3 size={12} />{new Date(review.due_at).toLocaleDateString(zh ? "zh-CN" : "en-US")}</>}</em>
        </Link>
        <button type="button" onClick={() => remove(review.symbol)} title={zh ? "标记已复核" : "Mark reviewed"} aria-label={`${zh ? "标记已复核" : "Mark reviewed"} ${review.symbol}`}><CheckCircle2 size={15} /></button>
      </article>;
    })}</div>
  </section>;
}
