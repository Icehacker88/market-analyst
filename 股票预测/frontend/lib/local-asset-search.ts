import { ASSET_CATALOG } from "./asset-catalog";
import { canonicalizeAsset } from "./assets";
import type { Asset } from "./types";

const INDUSTRY_KEYWORDS: Record<string, string> = {};

function tag(symbols: string[], keywords: string) {
  symbols.forEach((symbol) => { INDUSTRY_KEYWORDS[symbol] = `${INDUSTRY_KEYWORDS[symbol] || ""} ${keywords}`.trim(); });
}

tag(["NVDA", "AMD", "AVGO", "TSM", "MU", "ARM", "SMCI", "SOXX", "SMH", "512480.SH", "159325.SZ", "159327.SZ", "688256.SH", "688041.SH", "688981.SH", "603986.SH", "603501.SH", "002371.SZ"], "半导体 芯片 芯片设计 芯片制造 算力 国产芯片 semiconductor chip ai 人工智能");
tag(["MSFT", "GOOGL", "AMZN", "META", "ORCL", "CRM", "PLTR", "IGV"], "科技 软件 云计算 人工智能 ai technology software cloud");
tag(["300308.SZ", "000063.SZ", "002475.SZ"], "光模块 光通信 通信设备 数据中心 算力 optical communications networking");
tag(["002230.SZ", "688256.SH", "688041.SH", "601138.SH", "002415.SZ"], "人工智能 ai 算力 服务器 软件 科技 technology");
tag(["TSLA", "NIO", "XPEV", "LI", "002594.SZ", "1211.HK", "300750.SZ", "601127.SH"], "新能源汽车 电动车 电池 汽车 ev battery automobile");
tag(["BABA", "BIDU", "PDD", "JD", "TME", "NTES", "BILI", "BEKE", "FUTU", "0700.HK", "9988.HK", "3690.HK", "1810.HK", "9618.HK", "9999.HK", "1024.HK"], "中国互联网 中概股 电商 平台 china internet ecommerce");
tag(["LLY", "XBI", "600276.SH"], "医疗 医药 生物科技 创新药 biotechnology healthcare pharma");
tag(["GLD", "SLV"], "贵金属 黄金 白银 commodity metal gold silver");
tag(["COIN", "MSTR", "IBIT"], "比特币 加密货币 数字资产 bitcoin crypto digital asset");
tag(["SPY", "QQQ", "QQQM", "^NDX", "^IXIC", "NQ=F", "MNQ=F"], "美股 大盘 指数 纳斯达克 科技指数 us market index nasdaq");
tag(["600519.SH", "000858.SZ", "000333.SZ", "600887.SH"], "白酒 消费 家电 食品饮料 liquor consumer staples");
tag(["601318.SH", "000001.SZ", "600036.SH", "600030.SH", "1299.HK", "0388.HK"], "金融 银行 券商 证券 保险 交易所 finance bank insurance exchange");
tag(["601899.SH"], "有色 金属 黄金 铜 矿业 mining metal gold copper");
tag(["601012.SH"], "光伏 新能源 太阳能 solar renewable energy");

const LOCAL_ASSETS = ASSET_CATALOG.map((asset) => canonicalizeAsset(asset));

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s.,，。()（）'’"“”&/\\_-]+/g, "");
}

function searchable(asset: Asset): string[] {
  return [asset.symbol, asset.name, asset.name_en, asset.name_zh, asset.name_pinyin, INDUSTRY_KEYWORDS[asset.symbol]]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => [normalize(value), ...value.split(/\s+/).map(normalize)])
    .filter(Boolean);
}

function rank(asset: Asset, query: string): number | null {
  const needle = normalize(query);
  if (!needle) return null;
  const symbol = normalize(asset.symbol);
  const names = [asset.name, asset.name_en, asset.name_zh, asset.name_pinyin].filter((value): value is string => Boolean(value)).map(normalize);
  const terms = searchable(asset);
  if (symbol === needle) return 0;
  if (names.some((value) => value === needle)) return 2;
  if (symbol.startsWith(needle)) return 5;
  if (names.some((value) => value.startsWith(needle))) return 8;
  if (terms.some((value) => value.includes(needle))) return 20;
  const tokens = query.toLowerCase().split(/[\s,，/]+/).map(normalize).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => terms.some((value) => value.includes(token)))) return 28;
  return null;
}

export function searchLocalAssets(query: string, limit = 30): Asset[] {
  return LOCAL_ASSETS
    .map((asset, index) => ({ asset, index, score: rank(asset, query) }))
    .filter((item): item is { asset: Asset; index: number; score: number } => item.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.asset);
}

export function hasExactLocalMatch(query: string, assets: Asset[]): boolean {
  const needle = normalize(query);
  if (!needle) return false;
  return assets.some((asset) => normalize(asset.symbol) === needle);
}

export function mergeAssetResults(primary: Asset[], secondary: Asset[]): Asset[] {
  return [...new Map([...primary, ...secondary].map((asset) => {
    const normalized = canonicalizeAsset(asset);
    return [normalized.symbol, normalized] as const;
  })).values()];
}
