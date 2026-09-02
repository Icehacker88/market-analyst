import { LandingPage } from "@/components/landing-page";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

export default function Home() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    alternateName: ["Orivane Market Intelligence", "Orivane 股票预测", "orivane-market-intelligence.pages.dev"],
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    inLanguage: ["zh-CN", "en"],
  };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} /><LandingPage /></>;
}
