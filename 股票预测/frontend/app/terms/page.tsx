import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = { title: "使用条款", description: "Orivane 服务性质、允许使用与责任边界。", alternates: { canonical: `${SITE_URL}/terms/` } };

export default function TermsPage() { return <LegalPage kind="terms" />; }
