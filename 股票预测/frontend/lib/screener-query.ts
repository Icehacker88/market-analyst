import type { ScreenerRow } from "./types";

export type ScreenerMarket = "all" | "us" | "a" | "hk";

export type ParsedScreenerQuery = {
  market: ScreenerMarket;
  sector: string;
  signal: "all" | "Up" | "Down" | "Observe";
  minReturn: string;
  maxPe: string;
  maxVolatility: string;
  theme: string;
  sortKey: "return_1y" | "return_3m" | "return_1d" | "volatility_20d" | "latest_price";
  sortDirection: "asc" | "desc";
  labels: string[];
};

const THEME_PATTERNS = [
  { id: "semiconductor", pattern: /半导体|芯片|semiconductor|chip/i, words: ["半导体", "芯片", "semiconductor", "nvidia", "advanced micro devices", "broadcom", "micron", "台积电", "英伟达", "超威", "博通", "美光", "soxx", "smh"] },
  { id: "ai", pattern: /人工智能|生成式\s*ai|\bai\b/i, words: ["人工智能", "ai", "nvidia", "microsoft", "alphabet", "palantir", "英伟达", "微软", "谷歌", "帕兰蒂尔"] },
  { id: "ev", pattern: /新能源车|电动车|electric vehicle|\bev\b/i, words: ["新能源", "电动车", "electric vehicle", "tesla", "byd", "nio", "xpeng", "li auto", "特斯拉", "比亚迪", "蔚来", "小鹏", "理想"] },
  { id: "internet", pattern: /互联网|平台经济|internet platform/i, words: ["互联网", "platform", "tencent", "alibaba", "meituan", "baidu", "腾讯", "阿里", "美团", "百度"] },
] as const;

export function parseScreenerQuery(value: string): ParsedScreenerQuery {
  const text = value.trim();
  const market: ScreenerMarket = /港股|香港|hong\s*kong|\bhk\b/i.test(text)
    ? "hk"
    : /a股|沪深|内地|a[-\s]?share/i.test(text)
      ? "a"
      : /美股|美国|us\s*stock|nasdaq|纽交所/i.test(text)
        ? "us"
        : "all";
  const signal = /看跌|偏空|下行|bearish|downtrend/i.test(text)
    ? "Down"
    : /看涨|偏多|上行|bullish|uptrend/i.test(text)
      ? "Up"
      : /观望|中性|observe|neutral/i.test(text)
        ? "Observe"
        : "all";
  const theme = THEME_PATTERNS.find((item) => item.pattern.test(text))?.id || "";
  const sector = /医疗|医药|health/i.test(text) ? "Healthcare"
    : /金融|银行|保险|financial|bank/i.test(text) ? "Financial"
      : /消费|零售|consumer|retail/i.test(text) ? "Consumer"
        : /工业|制造|industrial/i.test(text) ? "Industrials"
          : /科技|技术|software|technology/i.test(text) || theme === "semiconductor" || theme === "ai" ? "Technology"
            : "all";
  const minReturn = numericAfter(text, /(?:1\s*年|一年|近年|year|1y)[^\d-]*(?:涨幅|收益|return)?[^\d-]*(?:不少于|不低于|超过|高于|至少|>=|>|above|over)?\s*(-?\d+(?:\.\d+)?)/i)
    || numericAfter(text, /(?:涨幅|收益|return)[^\d-]*(?:不少于|不低于|超过|高于|至少|>=|>|above|over)\s*(-?\d+(?:\.\d+)?)/i);
  const maxPe = numericAfter(text, /(?:市盈率|pe|p\/e)[^\d]*(?:不高于|低于|小于|<=|<|under|below)?\s*(\d+(?:\.\d+)?)/i);
  const maxVolatility = numericAfter(text, /(?:波动率|volatility)[^\d]*(?:不高于|低于|小于|<=|<|under|below)?\s*(\d+(?:\.\d+)?)/i)
    || (/低波动|low\s*volatility/i.test(text) ? "30" : "");
  const sortKey = /今日|当天|1\s*日|1d/i.test(text) ? "return_1d"
    : /3\s*月|三个月|3m/i.test(text) ? "return_3m"
      : /波动(?:率)?最高|most volatile/i.test(text) ? "volatility_20d"
        : /价格|price/i.test(text) ? "latest_price"
          : "return_1y";
  const sortDirection = /最低|最弱|最差|从低到高|ascending|lowest/i.test(text) ? "asc" : "desc";
  const labels = [
    market !== "all" ? market.toUpperCase() : "",
    theme ? themeLabel(theme) : "",
    sector !== "all" && !theme ? sector : "",
    signal !== "all" ? signal : "",
    minReturn ? `1Y >= ${minReturn}%` : "",
    maxPe ? `P/E <= ${maxPe}` : "",
    maxVolatility ? `Vol <= ${maxVolatility}%` : "",
  ].filter(Boolean);
  return { market, sector, signal, minReturn, maxPe, maxVolatility, theme, sortKey, sortDirection, labels };
}

export function matchesScreenerMarket(symbol: string, market: ScreenerMarket): boolean {
  if (market === "all") return true;
  if (market === "a") return /\.(SH|SZ|BJ)$/i.test(symbol);
  if (market === "hk") return /\.HK$/i.test(symbol);
  return !symbol.includes(".") && !symbol.startsWith("^") && !symbol.includes("=");
}

export function matchesScreenerTheme(row: ScreenerRow, theme: string): boolean {
  if (!theme) return true;
  const config = THEME_PATTERNS.find((item) => item.id === theme);
  if (!config) return true;
  const text = [row.symbol, row.name, row.name_en, row.name_zh, row.sector, row.recommendation_reason_zh, row.recommendation_reason_en, ...(row.recommendation_tags_zh || []), ...(row.recommendation_tags_en || [])].join(" ").toLowerCase();
  return config.words.some((word) => text.includes(word.toLowerCase()));
}

function numericAfter(value: string, pattern: RegExp): string {
  return value.match(pattern)?.[1] || "";
}

function themeLabel(theme: string): string {
  return ({ semiconductor: "Semiconductor", ai: "AI", ev: "EV", internet: "Internet" } as Record<string, string>)[theme] || theme;
}
