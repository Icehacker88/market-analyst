export type MarketTopic = {
  slug: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  keywords: string[];
  symbols: string[];
};

export const MARKET_TOPICS: MarketTopic[] = [
  {
    slug: "a-share-semiconductor-forecast",
    title: "A股半导体预测榜",
    titleEn: "A-share semiconductor forecast ranking",
    description: "比较寒武纪、海光信息、中芯国际、兆易创新、韦尔股份和北方华创的多周期模型预测、可信度与历史验证。",
    descriptionEn: "Compare multi-horizon forecasts, confidence and validation across major mainland semiconductor stocks.",
    keywords: ["A股半导体预测", "芯片股票预测", "寒武纪预测", "中芯国际预测"],
    symbols: ["688256.SH", "688041.SH", "688981.SH", "603986.SH", "603501.SH", "002371.SZ"],
  },
  {
    slug: "us-ai-stocks-forecast",
    title: "美股 AI 股票预测榜",
    titleEn: "US AI stocks forecast ranking",
    description: "比较英伟达、微软、谷歌、帕兰蒂尔、超威半导体和博通的未来走势、预测区间与验证成绩。",
    descriptionEn: "Compare the forecast paths, intervals and validation records of leading US AI stocks.",
    keywords: ["美股AI预测", "AI股票预测", "英伟达预测", "AMD预测"],
    symbols: ["NVDA", "MSFT", "GOOGL", "PLTR", "AMD", "AVGO"],
  },
  {
    slug: "hk-tech-stocks-forecast",
    title: "港股科技股预测榜",
    titleEn: "Hong Kong technology forecast ranking",
    description: "比较腾讯、阿里巴巴、美团、小米、京东和快手的未来 1 日、5 日、10 日与 1 个月模型路径。",
    descriptionEn: "Compare 1D, 5D, 10D and 1M model paths for leading Hong Kong technology stocks.",
    keywords: ["港股科技预测", "腾讯股价预测", "阿里巴巴预测", "小米股票预测"],
    symbols: ["0700.HK", "9988.HK", "3690.HK", "1810.HK", "9618.HK", "1024.HK"],
  },
  {
    slug: "global-semiconductor-forecast",
    title: "全球半导体股票与 ETF 预测榜",
    titleEn: "Global semiconductor stocks and ETF forecast ranking",
    description: "集中比较英伟达、超威半导体、博通、台积电、美光、SOXX 与 SMH 的趋势、风险和预测验证。",
    descriptionEn: "Compare trend, risk and forecast validation across global semiconductor leaders and ETFs.",
    keywords: ["半导体股票预测", "芯片ETF预测", "SOXX预测", "SMH预测"],
    symbols: ["NVDA", "AMD", "AVGO", "TSM", "MU", "SOXX", "SMH"],
  },
];

export function marketTopicBySlug(slug: string): MarketTopic | undefined {
  return MARKET_TOPICS.find((topic) => topic.slug === slug);
}
