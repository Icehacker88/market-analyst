import type { Metadata } from "next";
import { MethodologyContent } from "@/components/methodology-content";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "预测方法与使用限制",
  description: "Orivane 的市场预测、推荐分数、历史验证和使用限制说明。",
  alternates: { canonical: `${SITE_URL}/methodology/` },
};

export default function MethodologyPage() {
  return <MethodologyContent />;
}
