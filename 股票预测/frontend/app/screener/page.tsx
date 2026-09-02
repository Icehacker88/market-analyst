import type { Metadata } from "next";
import { ScreenerPage } from "@/components/screener-page";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "选股器",
  description: "按涨幅、估值、市值、行业、波动率和模型信号筛选全球股票、ETF、指数与基金。",
  alternates: { canonical: `${SITE_URL}/screener/` },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/screener/`,
    title: "Orivane 选股器",
    description: "筛选全球股票、ETF、指数与基金，发现趋势、估值和模型信号机会。",
  },
};
export default function Screener() { return <ScreenerPage />; }
