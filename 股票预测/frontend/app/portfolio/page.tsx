import type { Metadata } from "next";
import { PortfolioPage } from "@/components/portfolio-page";

export const metadata: Metadata = { title: "Portfolio", description: "Track holdings, market value and investment returns.", robots: { index: false, follow: false } };
export default function Portfolio() { return <PortfolioPage />; }
