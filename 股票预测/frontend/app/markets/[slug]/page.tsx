import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppLink as Link } from "@/components/app-link";
import { AssetLogo } from "@/components/asset-logo";
import { catalogAssetBySymbol } from "@/lib/asset-catalog";
import { formatMetricPercent, formatPercent } from "@/lib/format";
import { MARKET_TOPICS, marketTopicBySlug } from "@/lib/market-topics";
import seoForecasts from "@/lib/seo-forecast-snapshots.json";
import { SITE_NAME, SITE_URL } from "@/lib/site";

type Snapshot = { data_as_of: string; signal: string; confidence_score: number | null; forecast_1d_return: number | null; forecast_5d_return: number | null; forecast_10d_return: number | null; forecast_1m_return: number | null };
const SNAPSHOTS = seoForecasts as Record<string, Snapshot>;

export const dynamicParams = false;

export function generateStaticParams() {
  return MARKET_TOPICS.map((topic) => ({ slug: topic.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const topic = marketTopicBySlug((await params).slug);
  if (!topic) return {};
  const url = `${SITE_URL}/markets/${topic.slug}/`;
  return {
    title: `${topic.title} | 多周期走势与历史验证`,
    description: topic.description,
    keywords: [...topic.keywords, "Orivane", "股票预测", "AI股票分析"],
    alternates: { canonical: url },
    openGraph: { type: "website", url, title: `${topic.title} · ${SITE_NAME}`, description: topic.description },
  };
}

export default async function MarketTopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const topic = marketTopicBySlug((await params).slug);
  if (!topic) notFound();
  const rows = topic.symbols.flatMap((symbol) => {
    const asset = catalogAssetBySymbol(symbol);
    return asset ? [{ asset, snapshot: SNAPSHOTS[asset.slug] }] : [];
  }).sort((left, right) => Number(right.snapshot?.forecast_1m_return ?? -Infinity) - Number(left.snapshot?.forecast_1m_return ?? -Infinity));
  const url = `${SITE_URL}/markets/${topic.slug}/`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: topic.title,
    description: topic.description,
    url,
    itemListElement: rows.map(({ asset }, index) => ({ "@type": "ListItem", position: index + 1, name: `${asset.name_zh} ${asset.symbol}`, url: `${SITE_URL}/stocks/${asset.slug}/` })),
  };
  return <main className="page-shell market-topic-page">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
    <nav className="stock-breadcrumb" aria-label="Breadcrumb"><Link href="/">Orivane</Link><span>/</span><Link href="/stocks/">资产目录</Link><span>/</span><b>{topic.title}</b></nav>
    <header><small>ORIVANE MARKET RESEARCH</small><h1>{topic.title}</h1><p>{topic.description}</p><span>{topic.descriptionEn}</span></header>
    <section className="topic-method-note"><strong>如何阅读</strong><p>排名按构建时的 1 个月模型预测值排序；同时查看可信度、失效位和公开预测成绩。排序是研究入口，不是买卖建议。</p><Link href="/track-record/">查看冻结预测成绩</Link></section>
    <section className="topic-ranking"><header><strong>预测比较</strong><small>构建日期 {rows.map((row) => row.snapshot?.data_as_of).filter(Boolean).sort().at(-1) || "—"}</small></header><div>{rows.map(({ asset, snapshot }, index) => <Link href={`/stocks/${asset.slug}/`} key={asset.symbol}><b>{String(index + 1).padStart(2, "0")}</b><AssetLogo asset={asset} size="large" /><span><strong>{asset.name_zh}</strong><small>{asset.name_en} · {asset.symbol}</small></span><dl><div><dt>1D</dt><dd>{formatPercent(snapshot?.forecast_1d_return, true)}</dd></div><div><dt>5D</dt><dd>{formatPercent(snapshot?.forecast_5d_return, true)}</dd></div><div><dt>1M</dt><dd>{formatPercent(snapshot?.forecast_1m_return, true)}</dd></div><div><dt>可信度</dt><dd>{formatMetricPercent(snapshot?.confidence_score)}</dd></div></dl></Link>)}</div></section>
    <section className="topic-faq"><h2>常见问题</h2><article><strong>预测多久更新一次？</strong><p>行情有新交易日数据后更新，页面同时保留数据截止日期和生成时间。</p></article><article><strong>排名等于推荐买入吗？</strong><p>不等于。模型路径必须与历史验证优势、波动风险、关键价位和个人持仓情况一起判断。</p></article><article><strong>AI 在这里做什么？</strong><p>AI 用于解释结构化行情、预测和风险数据；数值预测由可回测的模型生成，AI 不直接改写历史成绩。</p></article></section>
  </main>;
}
