"use client";

import { ArrowRight, CalendarDays, CheckCircle2, ListChecks, Radar } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { assetPath } from "@/lib/asset-catalog";
import { readResearchHabit, recordResearchVisit, weeklyResearchStats } from "@/lib/research-habit";
import { reviewIsDue } from "@/lib/research-review";
import type { Asset } from "@/lib/types";
import { AppLink as Link } from "./app-link";
import { useApp } from "./providers";

export function ResearchHabitCard({ recentAssets = [] }: { recentAssets?: Asset[] }) {
  const { favorites, language, userState } = useApp();
  const zh = language === "zh";
  const [stats, setStats] = useState({ visitDays: 0, completedReviews: 0 });
  const reviews = useMemo(() => Object.values(userState.research_reviews || {}), [userState.research_reviews]);
  const dueReviews = reviews.filter((review) => reviewIsDue(review));

  useEffect(() => {
    const refresh = () => setStats(weeklyResearchStats(readResearchHabit(localStorage)));
    recordResearchVisit(localStorage);
    refresh();
    window.addEventListener("orivane-research-habit", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("orivane-research-habit", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const next = nextResearchAction({ favorites, recentAssets, reviews, dueReviews, visitDays: stats.visitDays, zh });
  const stepsCompleted = Number(favorites.length >= 3) + Number(reviews.length > 0) + Number(stats.visitDays >= 2);
  if (!favorites.length && !recentAssets.length) return null;

  return <section className="research-habit-card">
    <header>
      <span><CalendarDays size={16} /><span><strong>{zh ? "本周研究进度" : "Weekly research progress"}</strong><small>{zh ? "把一次查看变成可复核的研究习惯" : "Turn one-off views into a repeatable review habit"}</small></span></span>
      <b>{stepsCompleted}/3</b>
    </header>
    <div className="research-habit-metrics">
      <article><Radar size={14} /><span><small>{zh ? "本周回访" : "Visit days"}</small><strong>{stats.visitDays}<em>{zh ? " 天" : " days"}</em></strong></span></article>
      <article><CheckCircle2 size={14} /><span><small>{zh ? "完成复核" : "Reviews completed"}</small><strong>{stats.completedReviews}<em>{zh ? " 项" : ""}</em></strong></span></article>
      <article><ListChecks size={14} /><span><small>{zh ? "持续跟踪" : "Assets followed"}</small><strong>{favorites.length}<em>{zh ? " 只" : ""}</em></strong></span></article>
    </div>
    <div className="research-habit-progress" aria-label={zh ? `研究闭环完成 ${stepsCompleted}/3` : `${stepsCompleted}/3 research steps complete`}><i style={{ width: `${(stepsCompleted / 3) * 100}%` }} /></div>
    <Link className="research-habit-next" href={next.href} onClick={() => trackEvent("research_habit_cta")}>
      <span><small>{zh ? "建议下一步" : "Recommended next step"}</small><strong>{next.title}</strong><p>{next.body}</p></span><ArrowRight size={15} />
    </Link>
    <p className="research-habit-privacy">{zh ? "仅记录研究日期，不记录搜索词或对话内容。" : "Only research dates are stored; search terms and conversations are not recorded."}</p>
  </section>;
}

function nextResearchAction({ favorites, recentAssets, reviews, dueReviews, visitDays, zh }: {
  favorites: Asset[];
  recentAssets: Asset[];
  reviews: Array<{ symbol: string }>;
  dueReviews: Array<{ symbol: string }>;
  visitDays: number;
  zh: boolean;
}): { href: string; title: string; body: string } {
  if (favorites.length < 3) return {
    href: "/recommendations/",
    title: zh ? `再关注 ${3 - favorites.length} 只资产` : `Follow ${3 - favorites.length} more asset${favorites.length === 2 ? "" : "s"}`,
    body: zh ? "补齐每日研究清单，首页才能持续比较变化。" : "Complete the daily queue so the homepage can compare changes over time.",
  };
  if (dueReviews[0]) return {
    href: assetPath(dueReviews[0].symbol),
    title: zh ? `复核 ${dueReviews[0].symbol} 的最新变化` : `Review the latest ${dueReviews[0].symbol} changes`,
    body: zh ? "复核计划已到期，更新判断后再决定是否继续跟踪。" : "This review is due. Update the thesis before deciding whether to keep tracking it.",
  };
  const firstAsset = favorites[0] || recentAssets[0];
  if (!reviews.length && firstAsset) return {
    href: assetPath(firstAsset.symbol),
    title: zh ? `为 ${firstAsset.symbol} 保存首次复核` : `Schedule the first ${firstAsset.symbol} review`,
    body: zh ? "选择下一交易日、突破、回踩或失效位作为回来查看的理由。" : "Choose the next session, breakout, pullback or invalidation as a reason to return.",
  };
  if (visitDays < 2) return {
    href: "/favorites/",
    title: zh ? "查看收藏资产的新变化" : "Check new watchlist changes",
    body: zh ? "比较方向、可信度与失效位是否发生重要变化。" : "Compare material changes in direction, confidence and invalidation levels.",
  };
  return {
    href: "/recommendations/",
    title: zh ? "发现一个新的研究候选" : "Discover one new research candidate",
    body: zh ? "本周基础闭环已完成，可以扩展一个新的观察对象。" : "The weekly loop is complete; add one new asset to the research queue.",
  };
}
