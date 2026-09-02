import type { MetadataRoute } from "next";
import { ASSET_CATALOG } from "@/lib/asset-catalog";
import { MARKET_TOPICS } from "@/lib/market-topics";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/stocks/`, lastModified, changeFrequency: "weekly", priority: 0.95 },
    { url: `${SITE_URL}/recommendations/`, lastModified, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/screener/`, lastModified, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/track-record/`, lastModified, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/methodology/`, lastModified, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/risk-disclosure/`, lastModified, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/privacy/`, lastModified, changeFrequency: "yearly", priority: 0.4 },
    { url: `${SITE_URL}/terms/`, lastModified, changeFrequency: "yearly", priority: 0.4 },
    ...MARKET_TOPICS.map((topic) => ({
      url: `${SITE_URL}/markets/${topic.slug}/`,
      lastModified,
      changeFrequency: "daily" as const,
      priority: 0.85,
    })),
    ...ASSET_CATALOG.map((asset) => ({
      url: `${SITE_URL}/stocks/${asset.slug}/`,
      lastModified,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
  ];
}
