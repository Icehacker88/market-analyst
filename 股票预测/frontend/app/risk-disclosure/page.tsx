import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = { title: "预测与风险说明", description: "Orivane 预测限制、概率含义与使用方式说明。", alternates: { canonical: `${SITE_URL}/risk-disclosure/` } };

export default function RiskDisclosurePage() { return <LegalPage kind="risk" />; }
