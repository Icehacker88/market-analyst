import type { Metadata } from "next";
import { ForecastTrackRecord } from "@/components/forecast-track-record";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "预测成绩与模型治理",
  description: "查看 Orivane 走步回测、真实冻结预测、方向优势、Kronos 批次状态与模型漂移回滚记录。",
  alternates: { canonical: `${SITE_URL}/track-record/` },
};

export default function TrackRecordPage() {
  return <ForecastTrackRecord />;
}
