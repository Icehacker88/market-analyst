import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = { title: "隐私说明", description: "Orivane 数据收集、第三方服务与用户控制说明。", alternates: { canonical: `${SITE_URL}/privacy/` } };

export default function PrivacyPage() { return <LegalPage kind="privacy" />; }
