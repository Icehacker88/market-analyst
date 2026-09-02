import type { Metadata } from "next";
import { MonitorPage } from "@/components/monitor-page";

export const metadata: Metadata = {
  title: "运行监控",
  description: "Orivane 接口、缓存和数据源运行监控。",
  robots: { index: false, follow: false },
};

export default function Monitor() {
  return <MonitorPage />;
}
