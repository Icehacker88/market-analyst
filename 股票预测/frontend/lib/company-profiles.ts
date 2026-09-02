import type { CatalogAsset } from "./asset-catalog";

export type CompanyProfile = {
  summary_zh: string;
  summary_en: string;
  focus_zh: string[];
  focus_en: string[];
};

const PROFILES: Record<string, CompanyProfile> = {
  NVDA: {
    summary_zh: "英伟达是全球 GPU、AI 加速计算和数据中心芯片的重要公司，市场关注其 AI 服务器需求、毛利率和新一代芯片交付节奏。",
    summary_en: "NVIDIA is a leading GPU, AI computing and data-center semiconductor company. Investors watch AI server demand, margins and product-cycle execution.",
    focus_zh: ["AI 数据中心需求", "GPU 与加速计算生态", "毛利率和供应链交付"],
    focus_en: ["AI data-center demand", "GPU and accelerated-computing ecosystem", "Margins and supply-chain delivery"],
  },
  AAPL: {
    summary_zh: "苹果以 iPhone、Mac、可穿戴设备和服务生态为核心，市场重点关注换机周期、服务收入和 AI 功能对硬件需求的带动。",
    summary_en: "Apple is built around iPhone, Mac, wearables and services. Key watch items are replacement cycles, services revenue and AI-driven device demand.",
    focus_zh: ["iPhone 换机周期", "服务收入增长", "AI 功能商业化"],
    focus_en: ["iPhone replacement cycle", "Services growth", "AI feature monetization"],
  },
  MSFT: {
    summary_zh: "微软覆盖云计算、企业软件、AI 基础设施和生产力工具，市场关注 Azure 增长、AI Copilot 渗透率和利润率。",
    summary_en: "Microsoft spans cloud, enterprise software, AI infrastructure and productivity tools. Azure growth, Copilot adoption and margins are central.",
    focus_zh: ["Azure 云增长", "Copilot 渗透率", "企业软件续费能力"],
    focus_en: ["Azure cloud growth", "Copilot adoption", "Enterprise software renewals"],
  },
  AMZN: {
    summary_zh: "亚马逊由电商、云计算 AWS、广告和会员生态构成，核心观察点是 AWS 增速、零售利润率和广告业务扩张。",
    summary_en: "Amazon combines ecommerce, AWS, advertising and Prime membership. AWS growth, retail margins and ad expansion are the key drivers.",
    focus_zh: ["AWS 增速", "零售利润率", "广告收入扩张"],
    focus_en: ["AWS growth", "Retail margins", "Advertising expansion"],
  },
  GOOGL: {
    summary_zh: "谷歌母公司 Alphabet 以搜索广告、YouTube、云计算和 AI 模型为核心，关注广告景气、云利润和 AI 搜索体验变化。",
    summary_en: "Alphabet is centered on search ads, YouTube, cloud and AI models. Ad demand, cloud profitability and AI search changes matter most.",
    focus_zh: ["搜索广告景气", "YouTube 与云业务", "AI 搜索竞争"],
    focus_en: ["Search-ad demand", "YouTube and cloud", "AI search competition"],
  },
  TSLA: {
    summary_zh: "特斯拉覆盖电动车、能源存储和自动驾驶，市场关注交付量、价格策略、毛利率和自动驾驶商业化进展。",
    summary_en: "Tesla spans EVs, energy storage and autonomous driving. Deliveries, pricing, margins and autonomy commercialization drive the story.",
    focus_zh: ["交付量和价格策略", "汽车毛利率", "自动驾驶进展"],
    focus_en: ["Deliveries and pricing", "Auto gross margin", "Autonomy progress"],
  },
  "600519.SH": {
    summary_zh: "贵州茅台是中国高端白酒龙头，市场重点关注批价稳定性、渠道库存、分红能力和消费需求恢复。",
    summary_en: "Kweichow Moutai is China’s leading premium baijiu company. Investors watch wholesale pricing, channel inventory, dividends and consumption recovery.",
    focus_zh: ["高端白酒需求", "渠道库存和批价", "现金流与分红"],
    focus_en: ["Premium baijiu demand", "Channel inventory and pricing", "Cash flow and dividends"],
  },
  "300750.SZ": {
    summary_zh: "宁德时代是全球动力电池和储能电池龙头，市场关注电池出货、海外扩张、价格压力和新技术路线。",
    summary_en: "CATL is a global leader in EV and energy-storage batteries. Shipments, overseas expansion, pricing pressure and new battery technology are key.",
    focus_zh: ["动力电池出货", "储能和海外扩张", "价格与技术路线"],
    focus_en: ["EV battery shipments", "Storage and overseas growth", "Pricing and technology roadmap"],
  },
  "002594.SZ": {
    summary_zh: "比亚迪覆盖新能源汽车、电池和供应链制造，市场关注销量增长、出口、车型结构和价格竞争。",
    summary_en: "BYD covers new-energy vehicles, batteries and manufacturing. Sales growth, exports, model mix and price competition are the main watch items.",
    focus_zh: ["新能源车销量", "出口和车型结构", "价格竞争"],
    focus_en: ["NEV sales", "Exports and model mix", "Price competition"],
  },
  "0700.HK": {
    summary_zh: "腾讯控股覆盖社交、游戏、广告、金融科技和云服务，市场关注游戏新品、广告恢复、视频号商业化和股东回报。",
    summary_en: "Tencent spans social, games, ads, fintech and cloud. Games, ad recovery, Channels monetization and shareholder returns are central.",
    focus_zh: ["游戏和广告", "视频号商业化", "回购与分红"],
    focus_en: ["Games and ads", "Channels monetization", "Buybacks and dividends"],
  },
  "9988.HK": {
    summary_zh: "阿里巴巴覆盖电商、云计算、国际业务和本地生活，市场关注电商份额、云业务恢复和资本回报。",
    summary_en: "Alibaba covers ecommerce, cloud, international commerce and local services. Ecommerce share, cloud recovery and capital returns matter most.",
    focus_zh: ["电商竞争格局", "云业务恢复", "回购和分红"],
    focus_en: ["Ecommerce competition", "Cloud recovery", "Buybacks and dividends"],
  },
  QQQ: {
    summary_zh: "QQQ 跟踪纳斯达克 100 指数，集中暴露于大型科技和成长股，适合观察美国科技龙头整体趋势。",
    summary_en: "QQQ tracks the Nasdaq 100, giving concentrated exposure to large-cap technology and growth stocks.",
    focus_zh: ["大型科技权重", "利率和成长股估值", "指数动量"],
    focus_en: ["Mega-cap tech weights", "Rates and growth valuation", "Index momentum"],
  },
  SPY: {
    summary_zh: "SPY 跟踪标普 500 指数，是观察美国大盘股整体表现和市场风险偏好的核心 ETF。",
    summary_en: "SPY tracks the S&P 500 and is a core ETF for broad US large-cap market exposure and risk appetite.",
    focus_zh: ["美国大盘走势", "行业轮动", "盈利和利率预期"],
    focus_en: ["US large-cap trend", "Sector rotation", "Earnings and rate expectations"],
  },
};

export function companyProfileFor(asset: CatalogAsset): CompanyProfile {
  return PROFILES[asset.symbol] || {
    summary_zh: `${asset.name_zh}（${asset.symbol}）可用于观察该资产的行情走势、技术指标、模型预测和历史预测验证。`,
    summary_en: `${asset.name_en} (${asset.symbol}) can be tracked for market data, technical indicators, model forecasts and historical forecast validation.`,
    focus_zh: ["价格趋势", "波动风险", "预测验证"],
    focus_en: ["Price trend", "Volatility risk", "Forecast validation"],
  };
}
