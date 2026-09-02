import type { Metadata } from "next";
import { AppLink as Link } from "@/components/app-link";
import { AssetLogo } from "@/components/asset-logo";
import { ASSET_CATALOG } from "@/lib/asset-catalog";
import { SITE_NAME, SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "股票、ETF、指数与基金预测目录",
  description: "浏览 Orivane 覆盖的全球股票、A股、港股、ETF、指数与基金，进入独立页面查看行情、技术指标、未来走势预测和历史验证。",
  alternates: { canonical: `${SITE_URL}/stocks/` },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/stocks/`,
    title: `股票、ETF、指数与基金预测目录 · ${SITE_NAME}`,
    description: "全球资产行情、未来走势预测与历史验证目录。",
  },
};

const GROUPS = [
  { id: "us", title: "美股与中概股", test: (symbol: string, type: string) => type === "stock" && !symbol.includes(".") },
  { id: "a", title: "A股", test: (symbol: string) => /\.(SH|SZ|BJ)$/.test(symbol) },
  { id: "hk", title: "港股", test: (symbol: string) => symbol.endsWith(".HK") },
  { id: "fund", title: "ETF 与基金", test: (_symbol: string, type: string) => type === "etf" || type === "fund" },
  { id: "market", title: "指数与市场", test: (_symbol: string, type: string) => type === "index" || type === "market" || type === "currency" },
];

export default function StocksDirectoryPage() {
  const itemList = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Orivane 全球资产预测目录",
    url: `${SITE_URL}/stocks/`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: ASSET_CATALOG.map((asset, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: `${asset.name_zh} ${asset.symbol}`,
        url: `${SITE_URL}/stocks/${asset.slug}/`,
      })),
    },
  };
  return <main className="page-shell asset-directory">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }} />
    <header><small>ORIVANE MARKET DIRECTORY</small><h1>股票、ETF、指数与基金预测目录</h1><p>按市场浏览资产，进入独立页面查看行情、未来 1 日、5 日、10 日和 1 个月预测、历史方向命中率及模型验证。</p></header>
    {GROUPS.map((group) => {
      const assets = ASSET_CATALOG.filter((asset) => group.test(asset.symbol, asset.asset_type));
      return assets.length ? <section key={group.id}>
        <h2>{group.title}<small>{assets.length}</small></h2>
        <div>{assets.map((asset) => <Link prefetch={false} key={asset.symbol} href={`/stocks/${asset.slug}/`}>
          <AssetLogo asset={asset} size="large" />
          <span><strong>{asset.name_zh}</strong><small>{asset.name_en}</small></span>
          <b>{asset.symbol}</b>
        </Link>)}</div>
      </section> : null;
    })}
  </main>;
}
