import type { Metadata } from "next";
import Script from "next/script";
import { Header } from "@/components/header";
import { Providers } from "@/components/providers";
import { SiteFooter } from "@/components/site-footer";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE_NAME} 股票预测与全球市场分析`, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icon.svg", type: "image/svg+xml" }], apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] },
  appleWebApp: { capable: true, statusBarStyle: "default", title: SITE_NAME },
  formatDetection: { telephone: false },
  keywords: ["Orivane", "stock analysis", "stock forecast", "market forecast", "股票分析", "股票预测", "AI 股票分析", "A股预测", "美股预测", "ETF", "market data"],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: SITE_NAME, url: SITE_URL, title: `${SITE_NAME} 股票预测与全球市场分析`, description: SITE_DESCRIPTION },
  twitter: { card: "summary", title: `${SITE_NAME} 股票预测与全球市场分析`, description: SITE_DESCRIPTION },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const analyticsToken = process.env.NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN;
  return <html lang="zh-CN"><body><Providers><Header />{children}<SiteFooter /></Providers>{analyticsToken ? <Script id="cf-web-analytics" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon={JSON.stringify({ token: analyticsToken })} strategy="afterInteractive" /> : null}</body></html>;
}
