import type { Asset } from "./types";
import type { Language } from "./i18n";

const ALIASES: Record<string, string> = {
  yingweida: "NVDA",
  英伟达: "NVDA",
  nvidia: "NVDA",
  pingguo: "AAPL",
  苹果: "AAPL",
  apple: "AAPL",
  weiruan: "MSFT",
  微软: "MSFT",
  microsoft: "MSFT",
  yamaxun: "AMZN",
  亚马逊: "AMZN",
  amazon: "AMZN",
  guge: "GOOGL",
  谷歌: "GOOGL",
  google: "GOOGL",
  alphabet: "GOOGL",
};

const ENGLISH_NAMES: Record<string, string> = {
  SPY: "SPDR S&P 500 ETF Trust",
  QQQ: "Invesco QQQ Trust",
  QQQM: "Invesco NASDAQ 100 ETF",
  NVDA: "NVIDIA Corporation",
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corporation",
  AMZN: "Amazon.com, Inc.",
  GOOGL: "Alphabet Inc.",
  PLTR: "Palantir Technologies Inc.",
  AVGO: "Broadcom Inc.",
  AMD: "Advanced Micro Devices, Inc.",
  TSM: "Taiwan Semiconductor Manufacturing Company Limited",
  META: "Meta Platforms, Inc.",
  TSLA: "Tesla, Inc.",
  NFLX: "Netflix, Inc.",
  ORCL: "Oracle Corporation",
  CRM: "Salesforce, Inc.",
  COIN: "Coinbase Global, Inc.",
  HOOD: "Robinhood Markets, Inc.",
  MSTR: "Strategy Inc.",
  SMCI: "Super Micro Computer, Inc.",
  ARM: "Arm Holdings plc",
  MU: "Micron Technology, Inc.",
  LLY: "Eli Lilly and Company",
  BIDU: "Baidu, Inc.",
  BABA: "Alibaba Group Holding Limited",
  PDD: "PDD Holdings Inc.",
  JD: "JD.com, Inc.",
  NIO: "NIO Inc.",
  XPEV: "XPeng Inc.",
  LI: "Li Auto Inc.",
  TME: "Tencent Music Entertainment Group",
  NTES: "NetEase, Inc.",
  BILI: "Bilibili Inc.",
  BEKE: "KE Holdings Inc.",
  FUTU: "Futu Holdings Limited",
  SOXX: "iShares Semiconductor ETF",
  SMH: "VanEck Semiconductor ETF",
  IGV: "iShares Expanded Tech-Software Sector ETF",
  ARKK: "ARK Innovation ETF",
  XBI: "SPDR S&P Biotech ETF",
  GLD: "SPDR Gold Shares",
  SLV: "iShares Silver Trust",
  IBIT: "iShares Bitcoin Trust ETF",
  "300750.SZ": "Ningde Shidai",
  "002594.SZ": "Biyadi",
  "601318.SH": "Zhongguo Ping An",
  "000858.SZ": "Wuliangye",
  "^NDX": "NASDAQ 100 Index",
  "^IXIC": "NASDAQ Composite",
  "NQ=F": "Nasdaq 100 Futures",
  "MNQ=F": "Micro E-mini Nasdaq-100 Futures",
  "600519.SH": "Guizhou Maotai",
  "000001.SZ": "Ping An Yinhang",
  "300965.SZ": "Hengyu Xintong",
  "300308.SZ": "Zhongji Innolight Co., Ltd.",
  "301396.SZ": "Glory View Technology Co., Ltd.",
  "688256.SH": "Cambricon Technologies Corporation Limited",
  "688041.SH": "Hygon Information Technology Co., Ltd.",
  "688981.SH": "Semiconductor Manufacturing International Corporation",
  "603986.SH": "GigaDevice Semiconductor Inc.",
  "603501.SH": "Will Semiconductor Co., Ltd. Shanghai",
  "002371.SZ": "NAURA Technology Group Co., Ltd.",
  "002230.SZ": "iFLYTEK Co., Ltd.",
  "000063.SZ": "ZTE Corporation",
  "601138.SH": "Foxconn Industrial Internet Co., Ltd.",
  "000725.SZ": "BOE Technology Group Co., Ltd.",
  "002475.SZ": "Luxshare Precision Industry Co., Ltd.",
  "002415.SZ": "Hangzhou Hikvision Digital Technology Co., Ltd.",
  "601127.SH": "Seres Group Co., Ltd.",
  "600036.SH": "China Merchants Bank Co., Ltd.",
  "600030.SH": "CITIC Securities Company Limited",
  "601899.SH": "Zijin Mining Group Company Limited",
  "600276.SH": "Jiangsu Hengrui Pharmaceuticals Co., Ltd.",
  "000333.SZ": "Midea Group Co., Ltd.",
  "601012.SH": "LONGi Green Energy Technology Co., Ltd.",
  "600887.SH": "Inner Mongolia Yili Industrial Group Co., Ltd.",
  "016452.OF": "Nanfang Nasidake 100 Zhishu Jijin A",
  "0700.HK": "Tencent Holdings Limited",
  "9988.HK": "Alibaba Group Holding Limited",
  "3690.HK": "Meituan",
  "1810.HK": "Xiaomi Corporation",
  "9618.HK": "JD.com, Inc.",
  "9999.HK": "NetEase, Inc.",
  "1211.HK": "BYD Company Limited",
  "1299.HK": "AIA Group Limited",
  "0388.HK": "Hong Kong Exchanges and Clearing Limited",
  "1024.HK": "Kuaishou Technology",
};

const CHINESE_NAMES: Record<string, string> = {
  SPY: "标普 500 ETF",
  QQQ: "纳斯达克 100 ETF",
  QQQM: "景顺纳斯达克 100 ETF",
  NVDA: "英伟达",
  AAPL: "苹果",
  MSFT: "微软",
  AMZN: "亚马逊",
  GOOGL: "谷歌",
  PLTR: "帕兰蒂尔",
  AVGO: "博通",
  AMD: "超威半导体",
  TSM: "台积电",
  META: "Meta",
  TSLA: "特斯拉",
  NFLX: "奈飞",
  ORCL: "甲骨文",
  CRM: "赛富时",
  COIN: "Coinbase",
  HOOD: "Robinhood",
  MSTR: "Strategy",
  SMCI: "超微电脑",
  ARM: "Arm",
  MU: "美光科技",
  LLY: "礼来",
  BIDU: "百度",
  BABA: "阿里巴巴",
  PDD: "拼多多",
  JD: "京东",
  NIO: "蔚来",
  XPEV: "小鹏汽车",
  LI: "理想汽车",
  TME: "腾讯音乐",
  NTES: "网易",
  BILI: "哔哩哔哩",
  BEKE: "贝壳",
  FUTU: "富途控股",
  SOXX: "iShares 半导体 ETF",
  SMH: "VanEck 半导体 ETF",
  IGV: "iShares 软件行业 ETF",
  ARKK: "ARK 创新 ETF",
  XBI: "标普生物科技 ETF",
  GLD: "黄金 ETF",
  SLV: "白银 ETF",
  IBIT: "iShares 比特币 ETF",
  "300750.SZ": "宁德时代",
  "002594.SZ": "比亚迪",
  "601318.SH": "中国平安",
  "000858.SZ": "五粮液",
  "^NDX": "纳斯达克 100 指数",
  "^IXIC": "纳斯达克综合指数",
  "NQ=F": "纳斯达克 100 期货",
  "MNQ=F": "微型纳斯达克 100 期货",
  "^VIX": "芝加哥期权交易所波动率指数",
  "600519.SH": "贵州茅台",
  "000001.SZ": "平安银行",
  "300965.SZ": "恒宇信通",
  "300308.SZ": "中际旭创",
  "301396.SZ": "宏景科技",
  "688256.SH": "寒武纪",
  "688041.SH": "海光信息",
  "688981.SH": "中芯国际",
  "603986.SH": "兆易创新",
  "603501.SH": "韦尔股份",
  "002371.SZ": "北方华创",
  "002230.SZ": "科大讯飞",
  "000063.SZ": "中兴通讯",
  "601138.SH": "工业富联",
  "000725.SZ": "京东方 A",
  "002475.SZ": "立讯精密",
  "002415.SZ": "海康威视",
  "601127.SH": "赛力斯",
  "600036.SH": "招商银行",
  "600030.SH": "中信证券",
  "601899.SH": "紫金矿业",
  "600276.SH": "恒瑞医药",
  "000333.SZ": "美的集团",
  "601012.SH": "隆基绿能",
  "600887.SH": "伊利股份",
  "016452.OF": "南方纳斯达克 100 指数基金 A",
  "0700.HK": "腾讯控股",
  "9988.HK": "阿里巴巴",
  "3690.HK": "美团",
  "1810.HK": "小米集团",
  "9618.HK": "京东集团",
  "9999.HK": "网易",
  "1211.HK": "比亚迪股份",
  "1299.HK": "友邦保险",
  "0388.HK": "香港交易所",
  "1024.HK": "快手",
};

const PINYIN_NAMES: Record<string, string> = {
  "300750.SZ": "Ning De Shi Dai", "002594.SZ": "Bi Ya Di", "601318.SH": "Zhong Guo Ping An", "000858.SZ": "Wu Liang Ye",
  "600519.SH": "Gui Zhou Mao Tai", "000001.SZ": "Ping An Yin Hang", "300965.SZ": "Heng Yu Xin Tong", "300308.SZ": "Zhong Ji Xu Chuang",
  "301396.SZ": "Hong Jing Ke Ji", "688256.SH": "Han Wu Ji", "688041.SH": "Hai Guang Xin Xi", "688981.SH": "Zhong Xin Guo Ji",
  "603986.SH": "Zhao Yi Chuang Xin", "603501.SH": "Wei Er Gu Fen", "002371.SZ": "Bei Fang Hua Chuang", "002230.SZ": "Ke Da Xun Fei",
  "000063.SZ": "Zhong Xing Tong Xun", "601138.SH": "Gong Ye Fu Lian", "000725.SZ": "Jing Dong Fang A", "002475.SZ": "Li Xun Jing Mi",
  "002415.SZ": "Hai Kang Wei Shi", "601127.SH": "Sai Li Si", "600036.SH": "Zhao Shang Yin Hang", "600030.SH": "Zhong Xin Zheng Quan",
  "601899.SH": "Zi Jin Kuang Ye", "600276.SH": "Heng Rui Yi Yao", "000333.SZ": "Mei De Ji Tuan", "601012.SH": "Long Ji Lv Neng",
  "600887.SH": "Yi Li Gu Fen", "016452.OF": "Nan Fang Na Si Da Ke 100 Zhi Shu Ji Jin A", "0700.HK": "Teng Xun Kong Gu",
  "9988.HK": "A Li Ba Ba", "3690.HK": "Mei Tuan", "1810.HK": "Xiao Mi Ji Tuan", "9618.HK": "Jing Dong Ji Tuan",
  "9999.HK": "Wang Yi", "1211.HK": "Bi Ya Di Gu Fen", "1299.HK": "You Bang Bao Xian", "0388.HK": "Xiang Gang Jiao Yi Suo",
  "1024.HK": "Kuai Shou",
};

function aliasKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function hasChinese(value?: string | null): boolean {
  return Boolean(value && /[\u3400-\u9fff]/.test(value));
}

function isChineseMarketAsset(asset: Asset): boolean {
  return /\.(SH|SZ|BJ|OF|HK)$/i.test(asset.symbol) || asset.currency === "CNY" || asset.data_source === "eastmoney";
}

function chineseName(asset: Asset): string | null {
  return asset.name_zh || CHINESE_NAMES[asset.symbol] || (hasChinese(asset.name) ? asset.name : null);
}

function chineseFallbackName(asset: Asset): string {
  const label = ({
    stock: "股票",
    etf: "交易型基金",
    index: "指数",
    fund: "基金",
    currency: "外汇",
    market: "市场资产",
  } as const)[asset.asset_type];
  return `${label} ${asset.symbol}`;
}

export function canonicalSymbol(value: string): string {
  return ALIASES[aliasKey(value)] || value.trim().toUpperCase();
}

export function canonicalizeAsset(asset: Asset): Asset {
  const symbol = canonicalSymbol(asset.symbol);
  const zhName = asset.name_zh || CHINESE_NAMES[symbol] || (hasChinese(asset.name) ? asset.name : null);
  return {
    ...asset,
    symbol,
    name_zh: zhName || asset.name_zh,
    name_pinyin: asset.name_pinyin || PINYIN_NAMES[symbol] || null,
    name: symbol !== asset.symbol || asset.name.toUpperCase() === asset.symbol.toUpperCase()
      ? ENGLISH_NAMES[symbol] || symbol
      : asset.name,
  };
}

export function displayAssetName(asset: Asset, language: Language): string {
  const zhName = chineseName(asset);
  const name = language === "zh"
    ? zhName || chineseFallbackName(asset)
    : isChineseMarketAsset(asset) && zhName
      ? asset.name_pinyin || PINYIN_NAMES[asset.symbol] || asset.name_en || ENGLISH_NAMES[asset.symbol] || asset.name
      : asset.name_en || ENGLISH_NAMES[asset.symbol] || asset.name;
  return name.toUpperCase() === asset.symbol.toUpperCase() ? "" : name;
}
