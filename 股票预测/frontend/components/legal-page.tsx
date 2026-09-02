"use client";

import { useApp } from "./providers";

type LegalKind = "privacy" | "terms" | "risk";

const CONTENT = {
  privacy: {
    zh: { title: "隐私说明", subtitle: "尽量少收集数据，并明确数据用途。", sections: [
      ["收集内容", "未登录访问仅记录匿名功能事件、接口性能和错误信息，不记录输入内容、姓名或精确位置。登录后会保存邮箱、收藏、组合、提醒和语言偏好，用于跨设备同步。"],
      ["第三方服务", "账号登录、邮件、AI 解读和行情可能分别使用 Google、Resend、Gemini 及公开行情数据源。发送给 AI 的内容限于当前资产数据、对话上下文和用户问题。"],
      ["控制方式", "用户可在收藏与组合页面删除云端数据，或通过网站联系入口申请删除账号数据。浏览器本地偏好可通过清理站点数据移除。"],
    ] },
    en: { title: "Privacy", subtitle: "We minimize collection and state its purpose.", sections: [
      ["What is collected", "Anonymous visits record only product events, API performance and errors, without input text, names or precise location. Signed-in users store email, watchlists, portfolios, alerts and language preferences for cross-device sync."],
      ["Third parties", "Google, Resend, Gemini and public market-data providers may support authentication, email, AI interpretation and quotes. AI requests contain only the active asset context, conversation context and the user's question."],
      ["Your control", "Cloud data can be removed from watchlist and portfolio screens, or users may request account-data deletion through the site contact channel. Local preferences can be removed by clearing site data."],
    ] },
  },
  terms: {
    zh: { title: "使用条款", subtitle: "使用 Orivane 即表示同意以下研究用途边界。", sections: [
      ["服务性质", "Orivane 提供行情整理、模型预测、历史验证和 AI 研究辅助。服务可能延迟、中断或出现数据偏差，不承诺持续可用。"],
      ["允许使用", "可以将内容用于个人研究和学习；不得批量抓取、转售数据、绕过访问限制，或将页面内容冒充持牌投资建议。"],
      ["责任边界", "用户需自行核验行情、预测和新闻，并独立承担交易决定。模型输出不构成收益承诺、要约或个性化投资顾问服务。"],
    ] },
    en: { title: "Terms of Use", subtitle: "Using Orivane means accepting these research-use boundaries.", sections: [
      ["Service scope", "Orivane organizes market data, model forecasts, historical validation and AI research assistance. Data may be delayed or inaccurate, and uninterrupted availability is not guaranteed."],
      ["Permitted use", "Content may be used for personal research and education. Bulk scraping, resale, access-control bypassing or representing the content as licensed advice is prohibited."],
      ["Responsibility", "Users must independently verify quotes, forecasts and news and remain responsible for trading decisions. Outputs are not a return guarantee, offer or personalized advisory service."],
    ] },
  },
  risk: {
    zh: { title: "预测与风险说明", subtitle: "预测用于形成可验证的研究假设，不等于未来事实。", sections: [
      ["预测限制", "模型主要使用历史价格、成交量、技术结构和市场状态。突发新闻、财务造假、流动性变化及政策冲击可能令历史规律立即失效。"],
      ["概率含义", "页面概率来自冻结预测、走步留出样本或同方向历史样本，并非确定发生率。样本数量、基准优势和失效价位应与预测数值同时阅读。"],
      ["使用方式", "避免只依据单次预测交易。应结合仓位、期限、最大可承受损失、基本面和独立数据源，并在失效条件出现时重新评估。"],
    ] },
    en: { title: "Forecast and Risk Disclosure", subtitle: "Forecasts create testable research hypotheses, not future facts.", sections: [
      ["Forecast limits", "Models rely mainly on historical price, volume, technical structure and market regime. News shocks, fraud, liquidity changes and policy events can invalidate historical patterns immediately."],
      ["Probability meaning", "Displayed probabilities come from frozen calls, walk-forward holdouts or same-direction historical samples; they are not certainties. Read sample size, baseline edge and invalidation level together with the point estimate."],
      ["How to use", "Do not trade on one forecast alone. Consider position size, horizon, maximum tolerable loss, fundamentals and independent sources, and reassess when invalidation conditions occur."],
    ] },
  },
} as const;

export function LegalPage({ kind }: { kind: LegalKind }) {
  const { language } = useApp();
  const content = CONTENT[kind][language];
  return <main className="page-shell legal-page">
    <header className="page-title"><div><h1>{content.title}</h1><p>{content.subtitle}</p></div></header>
    <section className="legal-grid">{content.sections.map(([title, body]) => <article key={title}><h2>{title}</h2><p>{body}</p></article>)}</section>
  </main>;
}
