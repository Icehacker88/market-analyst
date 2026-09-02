"use client";

import { Bell, Bookmark, BriefcaseBusiness, ListFilter } from "lucide-react";
import { usePathname } from "next/navigation";
import { AppLink as Link } from "./app-link";
import { useApp } from "./providers";

export function ResearchNavigation() {
  const { language } = useApp();
  const pathname = usePathname();
  const zh = language === "zh";
  const items = [
    { href: "/favorites/", label: zh ? "观察列表" : "Watchlist", detail: zh ? "收藏与变化" : "Saved assets", icon: Bookmark },
    { href: "/portfolio/", label: zh ? "持仓组合" : "Portfolio", detail: zh ? "成本与盈亏" : "Cost and P/L", icon: BriefcaseBusiness },
    { href: "/favorites/#alerts", label: zh ? "提醒" : "Alerts", detail: zh ? "价格与预测" : "Price and forecast", icon: Bell },
    { href: "/screener/", label: zh ? "筛选条件" : "Saved screens", detail: zh ? "发现新候选" : "Discover candidates", icon: ListFilter },
  ];
  return <nav className="research-navigation" aria-label={zh ? "我的研究导航" : "My research navigation"}>
    {items.map(({ href, label, detail, icon: Icon }) => <Link key={href} href={href} className={pathname.startsWith(href.split("#")[0]) && !href.includes("#") ? "active" : ""}><Icon size={15} /><span><strong>{label}</strong><small>{detail}</small></span></Link>)}
  </nav>;
}
