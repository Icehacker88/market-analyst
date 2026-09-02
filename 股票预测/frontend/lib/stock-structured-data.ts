import type { CatalogAsset } from "./asset-catalog";
import type { CompanyProfile } from "./company-profiles";
import { SITE_URL } from "./site";

export type SeoForecastSnapshot = {
  data_as_of: string;
  signal: string;
  confidence_score: number | null;
  forecast_1d_return: number | null;
  forecast_5d_return: number | null;
  forecast_10d_return: number | null;
  forecast_1m_return: number | null;
};

type StockStructuredDataInput = {
  asset: CatalogAsset;
  profile: CompanyProfile;
  snapshot?: SeoForecastSnapshot;
  url: string;
};

export function buildStockStructuredData({ asset, profile, snapshot, url }: StockStructuredDataInput) {
  const graph: Record<string, unknown>[] = [
    {
      "@type": "WebPage",
      name: `${asset.name_zh} ${asset.symbol} 行情、走势与预测`,
      description: `${profile.summary_zh} ${profile.summary_en}`,
      url,
      inLanguage: ["zh-CN", "en"],
      about: { "@type": "Thing", name: asset.name_en, alternateName: [asset.name_zh, asset.symbol] },
    },
  ];

  if (snapshot) {
    graph.push({
      "@type": "Dataset",
      name: `${asset.name_zh} ${asset.symbol} Orivane 多周期预测快照`,
      description: `${asset.name_zh}（${asset.symbol}）截至 ${snapshot.data_as_of} 的 Orivane 多周期市场预测数据集，包含未来 1 日、5 日、10 日和 1 个月的预测收益率、方向信号与可信度评分，用于研究历史走势、验证模型表现和观察市场风险。`,
      url,
      dateModified: snapshot.data_as_of,
      creator: { "@type": "Organization", name: "Orivane", url: SITE_URL },
      license: `${SITE_URL}/terms/`,
      isAccessibleForFree: true,
      keywords: [asset.name_zh, asset.name_en, asset.symbol, "市场预测", "历史验证"],
      variableMeasured: ["1 day forecast return", "5 day forecast return", "10 day forecast return", "1 month forecast return"],
    });
  }

  graph.push({
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Orivane", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "资产目录", item: `${SITE_URL}/stocks/` },
      { "@type": "ListItem", position: 3, name: `${asset.name_zh} ${asset.symbol}`, item: url },
    ],
  });

  return { "@context": "https://schema.org", "@graph": graph };
}
