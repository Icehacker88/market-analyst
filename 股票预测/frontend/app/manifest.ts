import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Orivane 全球市场智能与模型预测",
    short_name: "Orivane",
    description: "股票、ETF、指数与基金行情、预测和历史验证。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f7f5f0",
    theme_color: "#117a72",
    categories: ["finance", "business", "productivity"],
    shortcuts: [
      { name: "推荐", short_name: "推荐", url: "/recommendations/", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] },
      { name: "收藏", short_name: "收藏", url: "/favorites/", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] },
      { name: "选股", short_name: "选股", url: "/screener/", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] },
    ],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
