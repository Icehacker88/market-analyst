"use client";

import { AppLink as Link } from "./app-link";
import { useApp } from "./providers";

export function SiteFooter() {
  const { language } = useApp();
  const zh = language === "zh";
  return <footer className="site-footer">
    <Link href="/markets/us-ai-stocks-forecast/">{zh ? "市场专题" : "Market topics"}</Link>
    <Link href="/track-record/">{zh ? "预测成绩" : "Forecast record"}</Link>
    <Link href="/methodology/">{zh ? "预测方法" : "Methodology"}</Link>
    <Link href="/risk-disclosure/">{zh ? "风险说明" : "Risk disclosure"}</Link>
    <Link href="/privacy/">{zh ? "隐私" : "Privacy"}</Link>
    <Link href="/terms/">{zh ? "条款" : "Terms"}</Link>
    <span>© {new Date().getFullYear()} Orivane</span>
  </footer>;
}
