import type { Asset } from "./types";

export type CatalogAsset = Asset & {
  slug: string;
  name_en: string;
  name_zh: string;
};

type CatalogRow = [string, string, string, string, Asset["asset_type"], Asset["data_source"]];

const ROWS: CatalogRow[] = [
  ["SPY", "spy", "SPDR S&P 500 ETF Trust", "标普 500 ETF", "etf", "yahoo"],
  ["QQQ", "qqq", "Invesco QQQ Trust", "纳斯达克 100 ETF", "etf", "yahoo"],
  ["QQQM", "qqqm", "Invesco NASDAQ 100 ETF", "景顺纳斯达克 100 ETF", "etf", "yahoo"],
  ["NVDA", "nvda", "NVIDIA Corporation", "英伟达", "stock", "yahoo"],
  ["AAPL", "aapl", "Apple Inc.", "苹果", "stock", "yahoo"],
  ["MSFT", "msft", "Microsoft Corporation", "微软", "stock", "yahoo"],
  ["AMZN", "amzn", "Amazon.com, Inc.", "亚马逊", "stock", "yahoo"],
  ["GOOGL", "googl", "Alphabet Inc.", "谷歌", "stock", "yahoo"],
  ["PLTR", "pltr", "Palantir Technologies Inc.", "帕兰蒂尔", "stock", "yahoo"],
  ["AVGO", "avgo", "Broadcom Inc.", "博通", "stock", "yahoo"],
  ["AMD", "amd", "Advanced Micro Devices, Inc.", "超威半导体", "stock", "yahoo"],
  ["TSM", "tsm", "Taiwan Semiconductor Manufacturing Company Limited", "台积电", "stock", "yahoo"],
  ["META", "meta", "Meta Platforms, Inc.", "Meta", "stock", "yahoo"],
  ["TSLA", "tsla", "Tesla, Inc.", "特斯拉", "stock", "yahoo"],
  ["NFLX", "nflx", "Netflix, Inc.", "奈飞", "stock", "yahoo"],
  ["ORCL", "orcl", "Oracle Corporation", "甲骨文", "stock", "yahoo"],
  ["CRM", "crm", "Salesforce, Inc.", "赛富时", "stock", "yahoo"],
  ["COIN", "coin", "Coinbase Global, Inc.", "Coinbase", "stock", "yahoo"],
  ["HOOD", "hood", "Robinhood Markets, Inc.", "Robinhood", "stock", "yahoo"],
  ["MSTR", "mstr", "Strategy Inc.", "Strategy", "stock", "yahoo"],
  ["SMCI", "smci", "Super Micro Computer, Inc.", "超微电脑", "stock", "yahoo"],
  ["ARM", "arm", "Arm Holdings plc", "Arm", "stock", "yahoo"],
  ["MU", "mu", "Micron Technology, Inc.", "美光科技", "stock", "yahoo"],
  ["LLY", "lly", "Eli Lilly and Company", "礼来", "stock", "yahoo"],
  ["BIDU", "bidu", "Baidu, Inc.", "百度", "stock", "yahoo"],
  ["BABA", "baba", "Alibaba Group Holding Limited", "阿里巴巴", "stock", "yahoo"],
  ["PDD", "pdd", "PDD Holdings Inc.", "拼多多", "stock", "yahoo"],
  ["JD", "jd", "JD.com, Inc.", "京东", "stock", "yahoo"],
  ["NIO", "nio", "NIO Inc.", "蔚来", "stock", "yahoo"],
  ["XPEV", "xpev", "XPeng Inc.", "小鹏汽车", "stock", "yahoo"],
  ["LI", "li-auto", "Li Auto Inc.", "理想汽车", "stock", "yahoo"],
  ["TME", "tme", "Tencent Music Entertainment Group", "腾讯音乐", "stock", "yahoo"],
  ["NTES", "ntes", "NetEase, Inc.", "网易", "stock", "yahoo"],
  ["BILI", "bili", "Bilibili Inc.", "哔哩哔哩", "stock", "yahoo"],
  ["BEKE", "beke", "KE Holdings Inc.", "贝壳", "stock", "yahoo"],
  ["FUTU", "futu", "Futu Holdings Limited", "富途控股", "stock", "yahoo"],
  ["SOXX", "soxx", "iShares Semiconductor ETF", "iShares 半导体 ETF", "etf", "yahoo"],
  ["SMH", "smh", "VanEck Semiconductor ETF", "VanEck 半导体 ETF", "etf", "yahoo"],
  ["IGV", "igv", "iShares Expanded Tech-Software Sector ETF", "iShares 软件行业 ETF", "etf", "yahoo"],
  ["ARKK", "arkk", "ARK Innovation ETF", "ARK 创新 ETF", "etf", "yahoo"],
  ["XBI", "xbi", "SPDR S&P Biotech ETF", "标普生物科技 ETF", "etf", "yahoo"],
  ["GLD", "gld", "SPDR Gold Shares", "黄金 ETF", "etf", "yahoo"],
  ["SLV", "slv", "iShares Silver Trust", "白银 ETF", "etf", "yahoo"],
  ["IBIT", "ibit", "iShares Bitcoin Trust ETF", "iShares 比特币 ETF", "etf", "yahoo"],
  ["300750.SZ", "300750-sz", "Contemporary Amperex Technology Co., Limited", "宁德时代", "stock", "yahoo"],
  ["002594.SZ", "002594-sz", "BYD Company Limited", "比亚迪", "stock", "yahoo"],
  ["601318.SH", "601318-sh", "Ping An Insurance (Group) Company of China, Ltd.", "中国平安", "stock", "yahoo"],
  ["000858.SZ", "000858-sz", "Wuliangye Yibin Co., Ltd.", "五粮液", "stock", "yahoo"],
  ["600519.SH", "600519-sh", "Kweichow Moutai", "贵州茅台", "stock", "yahoo"],
  ["000001.SZ", "000001-sz", "Ping An Bank", "平安银行", "stock", "yahoo"],
  ["300965.SZ", "300965-sz", "Hengyu Datacom", "恒宇信通", "stock", "yahoo"],
  ["300308.SZ", "300308-sz", "Zhongji Innolight Co., Ltd.", "中际旭创", "stock", "yahoo"],
  ["301396.SZ", "301396-sz", "Glory View Technology Co., Ltd.", "宏景科技", "stock", "yahoo"],
  ["688256.SH", "688256-sh", "Cambricon Technologies Corporation Limited", "寒武纪", "stock", "yahoo"],
  ["688041.SH", "688041-sh", "Hygon Information Technology Co., Ltd.", "海光信息", "stock", "yahoo"],
  ["688981.SH", "688981-sh", "Semiconductor Manufacturing International Corporation", "中芯国际", "stock", "yahoo"],
  ["603986.SH", "603986-sh", "GigaDevice Semiconductor Inc.", "兆易创新", "stock", "yahoo"],
  ["603501.SH", "603501-sh", "Will Semiconductor Co., Ltd. Shanghai", "韦尔股份", "stock", "yahoo"],
  ["002371.SZ", "002371-sz", "NAURA Technology Group Co., Ltd.", "北方华创", "stock", "yahoo"],
  ["002230.SZ", "002230-sz", "iFLYTEK Co., Ltd.", "科大讯飞", "stock", "yahoo"],
  ["000063.SZ", "000063-sz", "ZTE Corporation", "中兴通讯", "stock", "yahoo"],
  ["601138.SH", "601138-sh", "Foxconn Industrial Internet Co., Ltd.", "工业富联", "stock", "yahoo"],
  ["000725.SZ", "000725-sz", "BOE Technology Group Co., Ltd.", "京东方 A", "stock", "yahoo"],
  ["002475.SZ", "002475-sz", "Luxshare Precision Industry Co., Ltd.", "立讯精密", "stock", "yahoo"],
  ["002415.SZ", "002415-sz", "Hangzhou Hikvision Digital Technology Co., Ltd.", "海康威视", "stock", "yahoo"],
  ["601127.SH", "601127-sh", "Seres Group Co., Ltd.", "赛力斯", "stock", "yahoo"],
  ["600036.SH", "600036-sh", "China Merchants Bank Co., Ltd.", "招商银行", "stock", "yahoo"],
  ["600030.SH", "600030-sh", "CITIC Securities Company Limited", "中信证券", "stock", "yahoo"],
  ["601899.SH", "601899-sh", "Zijin Mining Group Company Limited", "紫金矿业", "stock", "yahoo"],
  ["600276.SH", "600276-sh", "Jiangsu Hengrui Pharmaceuticals Co., Ltd.", "恒瑞医药", "stock", "yahoo"],
  ["000333.SZ", "000333-sz", "Midea Group Co., Ltd.", "美的集团", "stock", "yahoo"],
  ["601012.SH", "601012-sh", "LONGi Green Energy Technology Co., Ltd.", "隆基绿能", "stock", "yahoo"],
  ["600887.SH", "600887-sh", "Inner Mongolia Yili Industrial Group Co., Ltd.", "伊利股份", "stock", "yahoo"],
  ["016452.OF", "016452-of", "China Southern NASDAQ 100 Index Fund A", "南方纳斯达克 100 指数基金 A", "fund", "eastmoney"],
  ["0700.HK", "0700-hk", "Tencent Holdings Limited", "腾讯控股", "stock", "yahoo"],
  ["9988.HK", "9988-hk", "Alibaba Group Holding Limited", "阿里巴巴", "stock", "yahoo"],
  ["3690.HK", "3690-hk", "Meituan", "美团", "stock", "yahoo"],
  ["1810.HK", "1810-hk", "Xiaomi Corporation", "小米集团", "stock", "yahoo"],
  ["9618.HK", "9618-hk", "JD.com, Inc.", "京东集团", "stock", "yahoo"],
  ["9999.HK", "9999-hk", "NetEase, Inc.", "网易", "stock", "yahoo"],
  ["1211.HK", "1211-hk", "BYD Company Limited", "比亚迪股份", "stock", "yahoo"],
  ["1299.HK", "1299-hk", "AIA Group Limited", "友邦保险", "stock", "yahoo"],
  ["0388.HK", "0388-hk", "Hong Kong Exchanges and Clearing Limited", "香港交易所", "stock", "yahoo"],
  ["1024.HK", "1024-hk", "Kuaishou Technology", "快手", "stock", "yahoo"],
  ["^NDX", "nasdaq-100-index", "NASDAQ 100 Index", "纳斯达克 100 指数", "index", "yahoo"],
  ["^IXIC", "nasdaq-composite", "NASDAQ Composite", "纳斯达克综合指数", "index", "yahoo"],
  ["NQ=F", "nasdaq-100-futures", "Nasdaq 100 Futures", "纳斯达克 100 期货", "market", "yahoo"],
  ["MNQ=F", "micro-nasdaq-100-futures", "Micro E-mini Nasdaq-100 Futures", "微型纳斯达克 100 期货", "market", "yahoo"],
  ["^VIX", "vix-index", "CBOE Volatility Index", "芝加哥期权交易所波动率指数", "index", "yahoo"],
];

export const ASSET_CATALOG: CatalogAsset[] = ROWS.map(([symbol, slug, name_en, name_zh, asset_type, data_source]) => ({
  symbol, slug, name: name_en, name_en, name_zh, asset_type, data_source,
}));

const BY_SYMBOL = new Map(ASSET_CATALOG.map((asset) => [asset.symbol, asset]));
const BY_SLUG = new Map(ASSET_CATALOG.map((asset) => [asset.slug, asset]));

export function catalogAssetBySymbol(symbol: string): CatalogAsset | undefined {
  return BY_SYMBOL.get(symbol.toUpperCase());
}

export function catalogAssetBySlug(slug: string): CatalogAsset | undefined {
  return BY_SLUG.get(slug.toLowerCase());
}

export function assetPath(symbol: string): string {
  const asset = catalogAssetBySymbol(symbol);
  return asset ? `/stocks/${asset.slug}/` : `/analysis/?symbols=${encodeURIComponent(symbol)}`;
}
