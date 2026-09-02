"use client";

import { ExternalLink } from "lucide-react";
import { formatMetricPercent, formatNumber, formatPercent } from "@/lib/format";
import type { CompanyResearch as Research } from "@/lib/types";
import { useApp } from "./providers";
import { EmptyState } from "./states";

function compact(value: number | null | undefined, currency = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${currency}${Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(value)}`;
}

export function CompanyResearch({ data }: { data?: Research }) {
  const { language } = useApp();
  if (!data) return <EmptyState message={language === "zh" ? "暂无公司研究数据。" : "Company research is not available."} />;
  const f = data.fundamentals;
  const labels = language === "zh" ? {
    profile: "公司概览", sector: "行业", marketCap: "总市值", pe: "市盈率", forwardPe: "预期市盈率", revenue: "营收",
    income: "净利润", revenueGrowth: "营收增长", incomeGrowth: "利润增长", range: "52 周区间", news: "最新新闻",
    summary: "研究摘要", strengths: "主要亮点", risks: "主要风险", earnings: "下次财报",
  } : { profile: "Company overview", sector: "Sector", marketCap: "Market cap", pe: "P/E", forwardPe: "Forward P/E", revenue: "Revenue", income: "Net income", revenueGrowth: "Revenue growth", incomeGrowth: "Profit growth", range: "52-week range", news: "Latest news", summary: "Research summary", strengths: "Key positives", risks: "Key risks", earnings: "Next earnings" };
  const newsTitle = data.news_region === "cn"
    ? (language === "zh" ? "国内可访问新闻" : "China-accessible news")
    : labels.news;
  const summary = language === "zh" ? data.summary_zh : data.summary_en;
  const strengths = language === "zh" ? data.strengths_zh : data.strengths_en;
  const risks = language === "zh" ? data.risks_zh : data.risks_en;
  const earningsDate = data.next_earnings_date
    ? `${data.next_earnings_date}${data.next_earnings_date_source === "nasdaq_estimate" ? (language === "zh" ? "（估）" : " est.") : ""}`
    : "—";
  return <div className="company-research-grid">
    <section><h3>{labels.profile}</h3>
    {summary && <div className="research-summary"><small>{labels.summary}</small><p>{summary}</p></div>}
    <dl className="metric-list">
      <div><dt>{labels.sector}</dt><dd>{localizeSector(data.sector, language)}</dd></div>
      <div><dt>{labels.marketCap}</dt><dd>{compact(f.trailingMarketCap, data.asset.currency === "CNY" ? "¥" : "$")}</dd></div>
      <div><dt>{labels.pe}</dt><dd>{formatNumber(f.trailingPeRatio)}</dd></div>
      <div><dt>{labels.forwardPe}</dt><dd>{formatNumber(f.trailingForwardPeRatio)}</dd></div>
      <div><dt>{labels.revenue}</dt><dd>{compact(f.trailingTotalRevenue, data.asset.currency === "CNY" ? "¥" : "$")}</dd></div>
      <div><dt>{labels.income}</dt><dd>{compact(f.trailingNetIncome, data.asset.currency === "CNY" ? "¥" : "$")}</dd></div>
      <div><dt>{labels.revenueGrowth}</dt><dd>{formatMetricPercent(f.revenueGrowth)}</dd></div>
      <div><dt>{labels.incomeGrowth}</dt><dd>{formatMetricPercent(f.netIncomeGrowth)}</dd></div>
      <div><dt>{labels.range}</dt><dd>{formatNumber(data.market.low_52w)} – {formatNumber(data.market.high_52w)}</dd></div>
      <div><dt>{labels.earnings}</dt><dd>{earningsDate}</dd></div>
      <div><dt>1Y</dt><dd>{formatPercent(data.market.return_1y, true)}</dd></div>
    </dl>
    <div className="research-notes">
      <article><strong>{labels.strengths}</strong>{(strengths || []).map((item) => <p key={item}>{item}</p>)}</article>
      <article><strong>{labels.risks}</strong>{(risks || []).map((item) => <p key={item}>{item}</p>)}</article>
    </div></section>
    <section><h3>{newsTitle}</h3>{data.news.length ? <div className="news-list">{data.news.map((item) => <a key={`${item.link}-${item.title}`} href={item.link} target="_blank" rel="noreferrer"><span><strong>{item.title}</strong><small>{item.publisher}{item.published_at ? ` · ${new Date(item.published_at).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US")}` : ""}</small></span><ExternalLink size={13} /></a>)}</div> : <EmptyState message={language === "zh" ? "暂无相关新闻。" : "No recent news."} />}</section>
  </div>;
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
  } as Record<string, string>)[value] || value;
}
