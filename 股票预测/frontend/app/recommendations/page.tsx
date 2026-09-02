import type { Metadata } from "next";
import { RecommendationsPage } from "@/components/recommendations-page";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "股票推荐",
  description: "Orivane 股票推荐页，覆盖 A 股推荐、美股推荐和港股推荐，并展示推荐分数、趋势理由和风险标签。",
  alternates: { canonical: `${SITE_URL}/recommendations/` },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/recommendations/`,
    title: "Orivane 股票推荐",
    description: "查看 A 股、美股和港股推荐资产，理解趋势、风险与推荐理由。",
  },
};

export default function Recommendations() {
  return <RecommendationsPage />;
}
