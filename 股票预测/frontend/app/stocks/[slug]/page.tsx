import type { Metadata } from "next";
import { AppLink as Link } from "@/components/app-link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Dashboard } from "@/components/dashboard";
import { ASSET_CATALOG, catalogAssetBySlug } from "@/lib/asset-catalog";
import { companyProfileFor } from "@/lib/company-profiles";
import seoForecasts from "@/lib/seo-forecast-snapshots.json";
import { SITE_URL } from "@/lib/site";
import { buildStockStructuredData, type SeoForecastSnapshot } from "@/lib/stock-structured-data";

const SEO_FORECASTS = seoForecasts as Record<string, SeoForecastSnapshot>;

export const dynamicParams = false;

export function generateStaticParams() {
  return ASSET_CATALOG.map((asset) => ({ slug: asset.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const asset = catalogAssetBySlug(slug);
  if (!asset) return {};
  const profile = companyProfileFor(asset);
  const title = `${asset.name_zh} ${asset.symbol} 行情、走势与预测 | ${asset.name_en}`;
  const description = `${profile.summary_zh} 查看 ${asset.name_zh}（${asset.symbol}）最新行情、历史走势、技术指标、模型预测与冻结预测验证。`;
  const url = `${SITE_URL}/stocks/${asset.slug}/`;
  return {
    title,
    description,
    keywords: [asset.name_zh, asset.name_en, asset.symbol, `${asset.name_zh}行情`, `${asset.name_zh}预测`, `${asset.symbol} forecast`, "股票预测", "技术分析"],
    alternates: { canonical: url },
    openGraph: { type: "website", url, title, description },
    twitter: { card: "summary", title, description },
  };
}

export default async function StockPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const asset = catalogAssetBySlug(slug);
  if (!asset) notFound();
  const profile = companyProfileFor(asset);
  const snapshot = SEO_FORECASTS[asset.slug];
  const url = `${SITE_URL}/stocks/${asset.slug}/`;
  const structuredData = buildStockStructuredData({ asset, profile, snapshot, url });
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
    <section className="stock-page-intro">
      <nav className="stock-breadcrumb" aria-label="Breadcrumb"><Link href="/">Orivane</Link><span>/</span><Link href="/stocks/">资产目录</Link><span>/</span><b>{asset.name_zh}</b></nav>
      <h1>
        <span className="stock-title-name">{asset.name_zh}</span>
        <span className="stock-title-symbol">{asset.symbol}</span>
        <span className="stock-title-suffix">行情、走势与预测</span>
      </h1>
      <p>{profile.summary_zh}</p>
      <div className="stock-profile-tags">{profile.focus_zh.map((item) => <span key={item}>{item}</span>)}</div>
    </section>
    <Suspense><Dashboard initialSymbols={[asset.symbol]} /></Suspense>
  </>;
}
