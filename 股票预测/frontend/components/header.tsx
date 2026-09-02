"use client";

import { AppLink as Link } from "./app-link";
import { Activity, Bookmark, BriefcaseBusiness, Gauge, Home, Languages, ListFilter, Menu, Moon, Sparkles, Sun, UserRound, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getHealth } from "@/lib/api";
import { isAdminUser } from "@/lib/admin";
import { useApp } from "./providers";
import { AuthModal } from "./auth-modal";
import { useAuth } from "./auth-provider";

const HEALTH_CACHE_KEY = "orivane-health-cache";
const HEALTH_CACHE_MS = 5 * 60 * 1000;

export function Header() {
  const { favorites, language, theme, t, toggleLanguage, toggleTheme, userState } = useApp();
  const { user } = useAuth();
  const pathname = usePathname();
  const isAdmin = isAdminUser(user);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<"checking" | "ok" | "degraded">("checking");
  const [authOpen, setAuthOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const unreadNotifications = (userState.alert_history || []).filter((item) => !item.read_at).length;
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    try {
      const cached = JSON.parse(sessionStorage.getItem(HEALTH_CACHE_KEY) || "null") as { lastUpdated: string | null; status?: "checking" | "ok" | "degraded"; expiresAt: number } | null;
      if (cached && cached.expiresAt > Date.now() && cached.status !== "checking") {
        setLastUpdated(cached.lastUpdated);
        setHealthStatus(cached.status || "degraded");
        return;
      }
    } catch {
      sessionStorage.removeItem(HEALTH_CACHE_KEY);
    }
    const timer = window.setTimeout(() => getHealth().then((health) => {
      if (!active) return;
      const next = health.last_updated || null;
      setLastUpdated(next);
      // A background provider probe does not mean cached market data is unavailable.
      const status = health.status === "degraded" ? "degraded" : "ok";
      setHealthStatus(status);
      sessionStorage.setItem(HEALTH_CACHE_KEY, JSON.stringify({ lastUpdated: next, status, expiresAt: Date.now() + HEALTH_CACHE_MS }));
    }).catch(() => {
      if (!active) return;
      setLastUpdated(null);
      setHealthStatus("degraded");
    }), 900);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    function close(event: PointerEvent) {
      if (!headerRef.current?.contains(event.target as Node)) setMoreOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => setMoreOpen(false), [pathname]);
  const active = (href: string) => href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <header className="topbar" ref={headerRef}>
      <Link href="/" className="brand" aria-label="Orivane">
        <span>Orivane</span>
        <i />
        <span className="brand-copy"><strong>{t("dashboard")}</strong><small>{t("subtitle")}</small></span>
      </Link>
      <nav className="top-actions desktop-actions" aria-label={language === "zh" ? "主要导航" : "Primary navigation"}>
        <span className={`health ${healthStatus}`}><i />{healthStatus === "checking" ? (language === "zh" ? "数据源：验证中" : "Data sources: verifying") : healthStatus === "ok" ? t("healthy") : (language === "zh" ? "数据源：部分不可用" : "Data sources: degraded")}{lastUpdated && <small>{t("updated")} {new Date(lastUpdated).toLocaleString(language === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>}</span>
        <Link href="/recommendations" className={`icon-button labeled ${active("/recommendations") ? "active" : ""}`} aria-label={language === "zh" ? "推荐" : "Recommendations"}><Sparkles size={16} /><span>{language === "zh" ? "推荐" : "Picks"}</span></Link>
        <Link href="/track-record" className={`icon-button labeled ${active("/track-record") ? "active" : ""}`} aria-label={language === "zh" ? "预测成绩" : "Forecast record"}><Gauge size={16} /><span>{language === "zh" ? "成绩" : "Record"}</span></Link>
        <Link href="/screener" className={`icon-button labeled ${active("/screener") ? "active" : ""}`} aria-label={language === "zh" ? "选股器" : "Screener"}><ListFilter size={16} /><span>{language === "zh" ? "选股" : "Screener"}</span></Link>
        <Link href="/favorites" className={`icon-button labeled ${active("/favorites") ? "active" : ""}`} aria-label={t("favorites")}>
          <Bookmark size={16} /> <span>{t("favorites")}</span><b>{unreadNotifications || favorites.length}</b>
        </Link>
        <button className="icon-button labeled account-button" onClick={() => setAuthOpen(true)} aria-label={user ? t("account") : t("login")}>
          {user?.pictureUrl ? <img src={user.pictureUrl} alt="" referrerPolicy="no-referrer" /> : <UserRound size={16} />}<span>{user?.name || user?.email || t("login")}</span>
        </button>
        <button className={`icon-button ${moreOpen ? "active" : ""}`} onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen} aria-controls="header-more-menu" aria-label={language === "zh" ? "更多" : "More"}>{moreOpen ? <X size={16} /> : <Menu size={16} />}</button>
      </nav>
      <button className="icon-button mobile-account" onClick={() => setAuthOpen(true)} aria-label={user ? t("account") : t("login")}>
        {user?.pictureUrl ? <img src={user.pictureUrl} alt="" referrerPolicy="no-referrer" /> : <UserRound size={17} />}
      </button>
      {moreOpen && <nav className="header-more-menu" id="header-more-menu" aria-label={language === "zh" ? "更多功能" : "More features"}>
        <Link href="/track-record" onClick={() => setMoreOpen(false)}><Gauge size={16} /><span><strong>{language === "zh" ? "预测成绩" : "Forecast record"}</strong><small>{language === "zh" ? "查看真实样本与回测" : "Review live calls and backtests"}</small></span></Link>
        <Link href="/portfolio" onClick={() => setMoreOpen(false)}><BriefcaseBusiness size={16} /><span><strong>{language === "zh" ? "投资组合" : "Portfolio"}</strong><small>{language === "zh" ? "记录持仓与成本" : "Track holdings and cost"}</small></span></Link>
        {isAdmin && <Link href="/monitor" onClick={() => setMoreOpen(false)}><Activity size={16} /><span><strong>{language === "zh" ? "运行监控" : "Monitor"}</strong><small>{language === "zh" ? "管理员运行状态" : "Admin runtime status"}</small></span></Link>}
        <button onClick={() => { setAuthOpen(true); setMoreOpen(false); }}><UserRound size={16} /><span><strong>{user ? t("account") : t("login")}</strong><small>{user?.email || (language === "zh" ? "同步收藏与偏好" : "Sync favorites and preferences")}</small></span></button>
        <button onClick={toggleLanguage}><Languages size={16} /><span><strong>{language === "zh" ? "切换至英文" : "切换至中文"}</strong><small>{language === "zh" ? "English interface" : "中文界面"}</small></span></button>
        <button onClick={toggleTheme}>{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}<span><strong>{theme === "light" ? t("dark") : t("light")}</strong><small>{language === "zh" ? "切换显示模式" : "Change appearance"}</small></span></button>
      </nav>}
      <nav className="mobile-bottom-nav" aria-label={language === "zh" ? "移动端导航" : "Mobile navigation"}>
        <Link href="/" className={active("/") ? "active" : ""}><Home size={19} /><span>{language === "zh" ? "首页" : "Home"}</span></Link>
        <Link href="/recommendations" className={active("/recommendations") ? "active" : ""}><Sparkles size={19} /><span>{language === "zh" ? "推荐" : "Picks"}</span></Link>
        <Link href="/screener" className={active("/screener") ? "active" : ""}><ListFilter size={19} /><span>{language === "zh" ? "选股" : "Screen"}</span></Link>
        <Link href="/favorites" className={active("/favorites") ? "active" : ""}><Bookmark size={19} /><span>{language === "zh" ? "收藏" : "Saved"}</span>{(unreadNotifications || favorites.length) > 0 && <b>{unreadNotifications || favorites.length}</b>}</Link>
        <button className={moreOpen ? "active" : ""} onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen} aria-controls="header-more-menu"><Menu size={19} /><span>{language === "zh" ? "更多" : "More"}</span></button>
      </nav>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </header>
  );
}
