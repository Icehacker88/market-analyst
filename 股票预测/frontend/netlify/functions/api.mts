import type { Config, Context } from "@netlify/functions";
import { getDeployStore, getStore } from "@netlify/blobs";
import { getUser } from "@netlify/identity";
import { pinyin } from "pinyin-pro";
import publicData from "./data/public-data.json" with { type: "json" };
import { sendEmail } from "./_shared/market-email.ts";
import { extractSseBlocks, parseSseBlock } from "../../lib/sse";

type Asset = {
  symbol: string;
  name: string;
  name_en?: string | null;
  name_zh?: string | null;
  name_pinyin?: string | null;
  asset_type: "stock" | "etf" | "index" | "fund" | "currency" | "market";
  exchange?: string | null;
  currency?: string | null;
  data_source: "yahoo" | "akshare" | "eastmoney";
};

type HistoryRecord = Record<string, number | string | null>;
type NewsRegion = "cn" | "global";
type AiLanguage = "zh" | "en";
type TrendForecast = {
  forecast1d: number;
  forecast5d: number;
  forecast10d: number;
  forecast1m: number;
  forecastDays: Array<Record<string, number | string>>;
  direction: "Up" | "Down";
  signal: "Up" | "Down" | "Observe";
  quality: "High" | "Medium" | "Low";
  strength: number;
  confidenceScore: number;
  agreementRatio: number;
  modelComponents: ForecastComponent[];
  marketRegime: ForecastMarketRegime;
  action: ForecastAction;
  keyLevels: ForecastKeyLevels;
  scenarios: ForecastScenario[];
  klineForecast: KlineForecastSignal;
  forecastVolatility1m: number;
  expectedRange1m: ForecastExpectedRange;
  optimization: ForecastOptimization;
  drivers_zh: string[];
  drivers_en: string[];
};
type ForecastHorizon = "1D" | "5D" | "10D" | "1M";
type HorizonModelSelection = {
  horizon: ForecastHorizon;
  selected_model: string;
  forecast_return: number;
  direction: "Up" | "Down";
  direction_probability: number | null;
  probability_samples: number;
  validation_samples: number;
  direction_accuracy: number | null;
  majority_baseline_accuracy: number | null;
  direction_edge: number | null;
  return_rmse: number | null;
  promoted: boolean;
  reason_zh: string;
  reason_en: string;
};
type HorizonForecasts = {
  d1: number;
  d5: number;
  d10: number;
  d22: number;
};
type ForecastContext = {
  benchmark_symbol?: string;
  benchmark_name?: string;
  benchmark_return_5d?: number | null;
  benchmark_return_20d?: number | null;
  official_kronos?: OfficialKronosForecast | null;
  contextual_signal?: ContextualForecastSignal | null;
};
type OfficialKronosForecast = {
  schema_version: "orivane-kronos-v1";
  source: "official_kronos";
  symbol: string;
  model_id: string;
  tokenizer_id: string;
  generated_at: string;
  data_as_of: string;
  base_price: number;
  lookback: number;
  prediction_length: number;
  sample_count: number;
  forecast_1d_return: number;
  forecast_5d_return: number;
  forecast_10d_return: number;
  forecast_1m_return: number;
  forecast_path?: Array<Record<string, number | string>>;
};
type ContextualForecastSignal = {
  score: number;
  news_score: number;
  fundamental_score: number;
  earnings_risk: boolean;
  earnings_date: string | null;
  earnings_days: number | null;
  forecasts: HorizonForecasts;
  inputs: string[];
  drivers_zh: string[];
  drivers_en: string[];
};
type ModelGovernance = {
  symbol: string;
  version: "model-governance-v1";
  status: "warming_up" | "stable" | "watch" | "rollback";
  active_model: "Orivane Horizon Router" | "Orivane Ensemble Safe Mode";
  evaluated_at: string;
  live_samples_20: number;
  live_samples_all: number;
  direction_edge_20: number | null;
  direction_edge_all: number | null;
  accuracy_20: number | null;
  accuracy_60: number | null;
  drift_score: number;
  rollback_count: number;
  reason_zh: string;
  reason_en: string;
};
type ForecastComponent = {
  model: string;
  forecast1d: number;
  forecast5d: number;
  forecast10d: number;
  forecast1m: number;
  weight: number;
  direction: "Up" | "Down";
  strength: number;
  drivers_zh: string[];
  drivers_en: string[];
};
type KlineForecastSignal = {
  model: "Orivane K-Line Structure";
  label_zh: string;
  label_en: string;
  score: number;
  forecast1d: number;
  pattern_score: number;
  volume_score: number;
  range_score: number;
  reversal_score: number;
  gap_score: number;
  atr_20: number;
  range_ratio_5_20: number;
  forecast_volatility_1m: number;
  drivers_zh: string[];
  drivers_en: string[];
};
type HistoricalAnalogSignal = {
  forecasts: HorizonForecasts;
  sample_size: number;
  up_probability: Record<"1D" | "5D" | "10D" | "1M", number | null>;
  drivers_zh: string[];
  drivers_en: string[];
};
type ForecastExpectedRange = {
  low: number;
  high: number;
  return_low: number;
  return_high: number;
};
type ForecastCalibration = {
  sample_size: number;
  total_samples: number;
  confidence_bucket: string;
  direction_hit_rate: number | null;
  average_1d_return: number | null;
  average_5d_return: number | null;
  average_10d_return: number | null;
  average_1m_return: number | null;
  note_zh: string;
  note_en: string;
};
type ForecastMarketRegime = {
  regime: "trend_up" | "trend_down" | "range" | "high_volatility";
  label_zh: string;
  label_en: string;
  daily_volatility: number;
  volume_ratio: number;
  benchmark_symbol?: string | null;
  benchmark_return_5d?: number | null;
  benchmark_return_20d?: number | null;
};
type ForecastAction = {
  stance: "accumulate" | "hold" | "reduce" | "wait";
  actionable: boolean;
  evidence_status: "validated" | "provisional" | "insufficient" | "negative_edge";
  label_zh: string;
  label_en: string;
  summary_zh: string;
  summary_en: string;
  abstain_reason_zh?: string | null;
  abstain_reason_en?: string | null;
};
type ForecastKeyLevels = {
  support: number | null;
  resistance: number | null;
  stop_loss: number | null;
  breakout: number | null;
  invalidation: number | null;
  invalidation_zh: string;
  invalidation_en: string;
};
type ForecastScenario = {
  name: "bull" | "base" | "bear";
  label_zh: string;
  label_en: string;
  probability: number;
  calibrated: false;
  expected_return: number;
  expected_price: number;
  narrative_zh: string;
  narrative_en: string;
};
type ForecastInterval = {
  horizon: "1D" | "5D" | "10D" | "1M";
  confidence_level: number;
  method: "split_conformal" | "empirical_conformal" | "volatility_fallback";
  calibration_samples: number;
  validation_samples: number;
  empirical_coverage: number | null;
  return_low: number;
  return_high: number;
  price_low: number;
  price_high: number;
};
type ForecastOptimization = {
  version: string;
  active: boolean;
  source: "history" | "ai" | "hybrid" | "fallback";
  generated_at: string;
  data_as_of?: string | null;
  sample_size: number;
  min_sample_size: number;
  ai_model?: string | null;
  component_multipliers: Record<string, number>;
  confidence_delta: number;
  applied_weight_shift?: number;
  notes_zh: string[];
  notes_en: string[];
  diagnostics?: Record<string, unknown>;
};
type AiAnalysis = {
  symbol: string;
  provider: "gemini";
  model: string;
  generated_at: string;
  language: AiLanguage;
  source: "gemini" | "structured_fallback";
  fallback_reason?: string | null;
  summary: string;
  forecast_read: string[];
  confidence_notes: string[];
  risks: string[];
  watch_items: string[];
  questions: string[];
};
type AuthUser = { id: string; email: string; name?: string; pictureUrl?: string | null; confirmedAt?: string };
type AuthRecord = AuthUser & { salt: string; password_hash: string; created_at: string; provider?: "email" | "google" | "apple"; google_sub?: string; apple_sub?: string; updated_at?: string };
type AuthSession = { token: string; user_id: string; email: string; expires_at: string };

const CATALOG: Asset[] = [
  { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", asset_type: "etf", exchange: "NYSE Arca", currency: "USD", data_source: "yahoo" },
  { symbol: "QQQ", name: "Invesco QQQ Trust", asset_type: "etf", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "AAPL", name: "Apple Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "NVDA", name: "NVIDIA Corporation", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "MSFT", name: "Microsoft Corporation", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "AMZN", name: "Amazon.com, Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "GOOGL", name: "Alphabet Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "PLTR", name: "Palantir Technologies Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "AVGO", name: "Broadcom Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "AMD", name: "Advanced Micro Devices, Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "TSM", name: "Taiwan Semiconductor Manufacturing Company Limited", asset_type: "stock", exchange: "NYSE", currency: "USD", data_source: "yahoo" },
  { symbol: "META", name: "Meta Platforms, Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "TSLA", name: "Tesla, Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "NFLX", name: "Netflix, Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "ORCL", name: "Oracle Corporation", asset_type: "stock", exchange: "NYSE", currency: "USD", data_source: "yahoo" },
  { symbol: "CRM", name: "Salesforce, Inc.", asset_type: "stock", exchange: "NYSE", currency: "USD", data_source: "yahoo" },
  { symbol: "COIN", name: "Coinbase Global, Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "HOOD", name: "Robinhood Markets, Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "MSTR", name: "Strategy Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "SMCI", name: "Super Micro Computer, Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "ARM", name: "Arm Holdings plc", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "MU", name: "Micron Technology, Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "LLY", name: "Eli Lilly and Company", asset_type: "stock", exchange: "NYSE", currency: "USD", data_source: "yahoo" },
  { symbol: "BIDU", name: "Baidu, Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "BABA", name: "Alibaba Group Holding Limited", asset_type: "stock", exchange: "NYSE", currency: "USD", data_source: "yahoo" },
  { symbol: "PDD", name: "PDD Holdings Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "JD", name: "JD.com, Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "NIO", name: "NIO Inc.", asset_type: "stock", exchange: "NYSE", currency: "USD", data_source: "yahoo" },
  { symbol: "XPEV", name: "XPeng Inc.", asset_type: "stock", exchange: "NYSE", currency: "USD", data_source: "yahoo" },
  { symbol: "LI", name: "Li Auto Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "TME", name: "Tencent Music Entertainment Group", asset_type: "stock", exchange: "NYSE", currency: "USD", data_source: "yahoo" },
  { symbol: "NTES", name: "NetEase, Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "BILI", name: "Bilibili Inc.", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "BEKE", name: "KE Holdings Inc.", asset_type: "stock", exchange: "NYSE", currency: "USD", data_source: "yahoo" },
  { symbol: "FUTU", name: "Futu Holdings Limited", asset_type: "stock", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "SOXX", name: "iShares Semiconductor ETF", asset_type: "etf", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "SMH", name: "VanEck Semiconductor ETF", asset_type: "etf", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "IGV", name: "iShares Expanded Tech-Software Sector ETF", asset_type: "etf", exchange: "BATS", currency: "USD", data_source: "yahoo" },
  { symbol: "ARKK", name: "ARK Innovation ETF", asset_type: "etf", exchange: "NYSE Arca", currency: "USD", data_source: "yahoo" },
  { symbol: "XBI", name: "SPDR S&P Biotech ETF", asset_type: "etf", exchange: "NYSE Arca", currency: "USD", data_source: "yahoo" },
  { symbol: "GLD", name: "SPDR Gold Shares", asset_type: "etf", exchange: "NYSE Arca", currency: "USD", data_source: "yahoo" },
  { symbol: "SLV", name: "iShares Silver Trust", asset_type: "etf", exchange: "NYSE Arca", currency: "USD", data_source: "yahoo" },
  { symbol: "IBIT", name: "iShares Bitcoin Trust ETF", asset_type: "etf", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "QQQM", name: "Invesco NASDAQ 100 ETF", asset_type: "etf", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "^IXIC", name: "NASDAQ Composite", asset_type: "index", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "^NDX", name: "NASDAQ 100 Index", asset_type: "index", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" },
  { symbol: "NQ=F", name: "Nasdaq 100 Futures", asset_type: "market", exchange: "CME", currency: "USD", data_source: "yahoo" },
  { symbol: "MNQ=F", name: "Micro E-mini Nasdaq-100 Futures", asset_type: "market", exchange: "CME", currency: "USD", data_source: "yahoo" },
  { symbol: "^VIX", name: "CBOE Volatility Index", asset_type: "index", exchange: "CBOE", currency: "USD", data_source: "yahoo" },
  { symbol: "600519.SH", name: "贵州茅台", asset_type: "stock", exchange: "SSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "000001.SZ", name: "平安银行", asset_type: "stock", exchange: "SZSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "300965.SZ", name: "恒宇信通", asset_type: "stock", exchange: "SZSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "300308.SZ", name: "中际旭创", asset_type: "stock", exchange: "SZSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "301396.SZ", name: "宏景科技", asset_type: "stock", exchange: "SZSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "688256.SH", name: "寒武纪", asset_type: "stock", exchange: "SSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "688041.SH", name: "海光信息", asset_type: "stock", exchange: "SSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "688981.SH", name: "中芯国际", asset_type: "stock", exchange: "SSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "603986.SH", name: "兆易创新", asset_type: "stock", exchange: "SSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "603501.SH", name: "韦尔股份", asset_type: "stock", exchange: "SSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "002371.SZ", name: "北方华创", asset_type: "stock", exchange: "SZSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "002230.SZ", name: "科大讯飞", asset_type: "stock", exchange: "SZSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "000063.SZ", name: "中兴通讯", asset_type: "stock", exchange: "SZSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "601138.SH", name: "工业富联", asset_type: "stock", exchange: "SSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "000725.SZ", name: "京东方 A", asset_type: "stock", exchange: "SZSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "002475.SZ", name: "立讯精密", asset_type: "stock", exchange: "SZSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "002415.SZ", name: "海康威视", asset_type: "stock", exchange: "SZSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "601127.SH", name: "赛力斯", asset_type: "stock", exchange: "SSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "600036.SH", name: "招商银行", asset_type: "stock", exchange: "SSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "600030.SH", name: "中信证券", asset_type: "stock", exchange: "SSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "601899.SH", name: "紫金矿业", asset_type: "stock", exchange: "SSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "600276.SH", name: "恒瑞医药", asset_type: "stock", exchange: "SSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "000333.SZ", name: "美的集团", asset_type: "stock", exchange: "SZSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "601012.SH", name: "隆基绿能", asset_type: "stock", exchange: "SSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "600887.SH", name: "伊利股份", asset_type: "stock", exchange: "SSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "300750.SZ", name: "宁德时代", asset_type: "stock", exchange: "SZSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "002594.SZ", name: "比亚迪", asset_type: "stock", exchange: "SZSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "601318.SH", name: "中国平安", asset_type: "stock", exchange: "SSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "000858.SZ", name: "五粮液", asset_type: "stock", exchange: "SZSE", currency: "CNY", data_source: "yahoo" },
  { symbol: "016452.OF", name: "南方纳斯达克100指数发起(QDII)A", asset_type: "fund", exchange: "OTC", currency: "CNY", data_source: "eastmoney" },
  { symbol: "0700.HK", name: "腾讯控股", asset_type: "stock", exchange: "HKEX", currency: "HKD", data_source: "yahoo" },
  { symbol: "9988.HK", name: "阿里巴巴", asset_type: "stock", exchange: "HKEX", currency: "HKD", data_source: "yahoo" },
  { symbol: "3690.HK", name: "美团", asset_type: "stock", exchange: "HKEX", currency: "HKD", data_source: "yahoo" },
  { symbol: "1810.HK", name: "小米集团", asset_type: "stock", exchange: "HKEX", currency: "HKD", data_source: "yahoo" },
  { symbol: "9618.HK", name: "京东集团", asset_type: "stock", exchange: "HKEX", currency: "HKD", data_source: "yahoo" },
  { symbol: "9999.HK", name: "网易", asset_type: "stock", exchange: "HKEX", currency: "HKD", data_source: "yahoo" },
  { symbol: "1211.HK", name: "比亚迪股份", asset_type: "stock", exchange: "HKEX", currency: "HKD", data_source: "yahoo" },
  { symbol: "1299.HK", name: "友邦保险", asset_type: "stock", exchange: "HKEX", currency: "HKD", data_source: "yahoo" },
  { symbol: "0388.HK", name: "香港交易所", asset_type: "stock", exchange: "HKEX", currency: "HKD", data_source: "yahoo" },
  { symbol: "1024.HK", name: "快手", asset_type: "stock", exchange: "HKEX", currency: "HKD", data_source: "yahoo" },
];
const ASSET_CHINESE_NAMES: Record<string, string> = {
  SPY: "标普 500 ETF", QQQ: "纳斯达克 100 ETF", QQQM: "景顺纳斯达克 100 ETF",
  AAPL: "苹果", NVDA: "英伟达", MSFT: "微软", AMZN: "亚马逊", GOOGL: "谷歌",
  PLTR: "帕兰蒂尔", AVGO: "博通", AMD: "超威半导体", TSM: "台积电", META: "Meta",
  TSLA: "特斯拉", NFLX: "奈飞", ORCL: "甲骨文", CRM: "赛富时", SMCI: "超微电脑",
  ARM: "Arm", MU: "美光科技", LLY: "礼来", SOXX: "iShares 半导体 ETF", SMH: "VanEck 半导体 ETF",
  BIDU: "百度", BABA: "阿里巴巴", PDD: "拼多多", JD: "京东", NIO: "蔚来",
  XPEV: "小鹏汽车", LI: "理想汽车", TME: "腾讯音乐", NTES: "网易", BILI: "哔哩哔哩",
  BEKE: "贝壳", FUTU: "富途控股",
  "300308.SZ": "中际旭创", "301396.SZ": "宏景科技", "688256.SH": "寒武纪", "688041.SH": "海光信息",
  "688981.SH": "中芯国际", "603986.SH": "兆易创新", "603501.SH": "韦尔股份", "002371.SZ": "北方华创",
  "002230.SZ": "科大讯飞", "000063.SZ": "中兴通讯", "601138.SH": "工业富联", "000725.SZ": "京东方 A",
  "002475.SZ": "立讯精密", "002415.SZ": "海康威视", "601127.SH": "赛力斯", "600036.SH": "招商银行",
  "600030.SH": "中信证券", "601899.SH": "紫金矿业", "600276.SH": "恒瑞医药", "000333.SZ": "美的集团",
  "601012.SH": "隆基绿能", "600887.SH": "伊利股份",
};
const GROWTH_SYMBOLS = [
  "PLTR", "NVDA", "AVGO", "AMD", "TSM", "META", "TSLA", "NFLX", "AMZN", "GOOGL", "MSFT", "AAPL",
  "ORCL", "CRM", "COIN", "HOOD", "MSTR", "SMCI", "ARM", "MU", "LLY", "SOXX", "SMH", "IGV", "ARKK",
  "XBI", "GLD", "SLV", "IBIT", "QQQ", "SPY", "300750.SZ", "002594.SZ", "601318.SH", "600519.SH", "000858.SZ",
];
const RECOMMENDATION_SYMBOLS = {
  a_shares: ["300750.SZ", "002594.SZ", "601318.SH", "600519.SH", "000858.SZ", "000001.SZ", "300965.SZ"],
  us_stocks: ["NVDA", "PLTR", "AVGO", "AMD", "ARM", "MU", "META", "GOOGL", "MSFT", "AAPL", "AMZN", "TSLA"],
  hk_stocks: ["0700.HK", "9988.HK", "3690.HK", "1810.HK", "9618.HK", "9999.HK", "1211.HK", "1299.HK", "0388.HK", "1024.HK"],
} as const;

const SECTORS: Record<string, string> = {
  AAPL: "Technology", NVDA: "Technology", MSFT: "Technology", AMZN: "Consumer", GOOGL: "Communication",
  PLTR: "Technology", AVGO: "Technology", AMD: "Technology", TSM: "Technology", META: "Communication",
  TSLA: "Consumer", NFLX: "Communication", ORCL: "Technology", CRM: "Technology", COIN: "Financial",
  HOOD: "Financial", MSTR: "Technology", SMCI: "Technology", ARM: "Technology", MU: "Technology",
  LLY: "Healthcare", "300750.SZ": "Industrials", "002594.SZ": "Consumer", "601318.SH": "Financial",
  "600519.SH": "Consumer", "000858.SZ": "Consumer", "000001.SZ": "Financial", "300965.SZ": "Industrials",
  "0700.HK": "Communication", "9988.HK": "Consumer", "3690.HK": "Consumer", "1810.HK": "Technology",
  "9618.HK": "Consumer", "9999.HK": "Communication", "1211.HK": "Consumer", "1299.HK": "Financial",
  "0388.HK": "Financial", "1024.HK": "Communication",
};

const FUNDAMENTAL_TYPES = [
  "trailingMarketCap", "trailingPeRatio", "trailingForwardPeRatio", "trailingTotalRevenue", "trailingNetIncome",
  "trailingOperatingMargin", "trailingReturnOnEquity", "annualTotalRevenue", "annualNetIncome",
];

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
  超威半导体: "AMD",
  chaoweibandaoti: "AMD",
  百度: "BIDU",
  baidu: "BIDU",
  阿里巴巴: "BABA",
  拼多多: "PDD",
  京东: "JD",
  蔚来: "NIO",
  小鹏汽车: "XPEV",
  理想汽车: "LI",
  哔哩哔哩: "BILI",
  贝壳: "BEKE",
  富途: "FUTU",
  中际旭创: "300308.SZ",
  zhongjixuchuang: "300308.SZ",
  宏景科技: "301396.SZ",
  hongjingkeji: "301396.SZ",
  寒武纪: "688256.SH",
  hanwuji: "688256.SH",
  海光信息: "688041.SH",
  haiguangxinxi: "688041.SH",
  中芯国际: "688981.SH",
  zhongxinguoji: "688981.SH",
  兆易创新: "603986.SH",
  zhaoyichuangxin: "603986.SH",
  韦尔股份: "603501.SH",
  weiergufen: "603501.SH",
  北方华创: "002371.SZ",
  beifanghuachuang: "002371.SZ",
  科大讯飞: "002230.SZ",
  kedaxunfei: "002230.SZ",
  中兴通讯: "000063.SZ",
  zhongxingtongxun: "000063.SZ",
  工业富联: "601138.SH",
  gongyefulian: "601138.SH",
  京东方: "000725.SZ",
  jingdongfang: "000725.SZ",
  立讯精密: "002475.SZ",
  lixunjingmi: "002475.SZ",
  海康威视: "002415.SZ",
  haikangweishi: "002415.SZ",
  赛力斯: "601127.SH",
  sailisi: "601127.SH",
  招商银行: "600036.SH",
  zhaoshangyinhang: "600036.SH",
  中信证券: "600030.SH",
  zhongxinzhengquan: "600030.SH",
  紫金矿业: "601899.SH",
  zijinkuangye: "601899.SH",
  恒瑞医药: "600276.SH",
  hengruiyiyao: "600276.SH",
  美的集团: "000333.SZ",
  meidejituan: "000333.SZ",
  隆基绿能: "601012.SH",
  longjilvneng: "601012.SH",
  伊利股份: "600887.SH",
  yiligufen: "600887.SH",
};
const DIRECT_SYMBOL_PATTERN = /^(?:[A-Z]{1,5}|[A-Z]{1,4}\.[A-Z]|\d{4,6}\.(?:HK|SH|SZ|BJ|OF)|[A-Z0-9]{1,10}=X|\^[A-Z0-9]{1,10}|[A-Z0-9]{1,10}-[A-Z0-9]{1,10}|\d{6}(?:\.(?:SH|SZ|BJ|OF))?)$/;
const SEARCH_EXPANSIONS: Record<string, string[]> = {
  纳斯达克: ["NASDAQ", "Nasdaq 100"],
  纳指: ["NASDAQ", "Nasdaq 100"],
  标普: ["S&P 500"],
  道琼斯: ["Dow Jones"],
  道指: ["Dow Jones"],
  恒生: ["Hang Seng"],
  黄金: ["Gold"],
  原油: ["Crude Oil"],
  比特币: ["Bitcoin"],
  半导体: ["semiconductor", "chip", "Advanced Micro Devices"],
  芯片: ["semiconductor", "chip"],
  国产芯片: ["semiconductor", "chip", "China semiconductor"],
  光模块: ["optical communication", "networking"],
  光通信: ["optical communication", "networking"],
  算力: ["AI computing", "data center", "semiconductor"],
  ai芯片: ["AI chip", "semiconductor"],
  semiconductor: ["semiconductor", "chip"],
  chip: ["semiconductor", "chip"],
  中概股: ["China ADR", "Chinese stocks"],
  新能源车: ["China EV", "electric vehicle"],
  电动车: ["electric vehicle", "China EV"],
};
const SEARCH_RECOMMENDATIONS: Record<string, string[]> = {
  纳斯达克: ["^IXIC", "^NDX", "QQQ", "QQQM", "NQ=F", "MNQ=F"],
  纳指: ["^IXIC", "^NDX", "QQQ", "QQQM", "NQ=F", "MNQ=F"],
  标普: ["SPY"],
  半导体: ["NVDA", "AMD", "AVGO", "TSM", "MU", "ARM", "SMCI", "688256.SH", "688041.SH", "688981.SH", "603986.SH", "603501.SH", "002371.SZ", "SOXX", "SMH"],
  芯片: ["NVDA", "AMD", "AVGO", "TSM", "MU", "ARM", "SMCI", "688256.SH", "688041.SH", "688981.SH", "603986.SH", "603501.SH", "002371.SZ", "SOXX", "SMH"],
  国产芯片: ["688256.SH", "688041.SH", "688981.SH", "603986.SH", "603501.SH", "002371.SZ"],
  光模块: ["300308.SZ", "000063.SZ", "002475.SZ"],
  光通信: ["300308.SZ", "000063.SZ", "002475.SZ"],
  算力: ["688256.SH", "688041.SH", "601138.SH", "002230.SZ", "NVDA", "AMD"],
  ai芯片: ["NVDA", "AMD", "AVGO", "TSM", "ARM", "MU", "688256.SH", "688041.SH"],
  semiconductor: ["NVDA", "AMD", "AVGO", "TSM", "MU", "ARM", "SOXX", "SMH"],
  chip: ["NVDA", "AMD", "AVGO", "TSM", "MU", "ARM", "SOXX", "SMH"],
  中概股: ["BABA", "PDD", "BIDU", "JD", "NIO", "XPEV", "LI", "TME", "NTES", "BILI", "BEKE", "FUTU"],
  新能源车: ["TSLA", "NIO", "XPEV", "LI", "002594.SZ", "1211.HK"],
  电动车: ["TSLA", "NIO", "XPEV", "LI", "002594.SZ", "1211.HK"],
};
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" };
const LONG_CACHE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=900, stale-while-revalidate=3600",
  "CDN-Cache-Control": "public, max-age=900, stale-while-revalidate=3600",
  "Cloudflare-CDN-Cache-Control": "public, max-age=900, stale-while-revalidate=3600",
};
const GEO_CACHE_HEADERS = { ...LONG_CACHE_HEADERS, vary: "CF-IPCountry" };
const PRIVATE_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" };
const YAHOO_HEADERS = { "user-agent": "Mozilla/5.0 Orivane/1.0" };
const EASTMONEY_SEARCH_TOKEN = "D43BF722C8E33EABDEC1CCEA356E6D74";
const LOGO_HEADERS = { "content-type": "image/png", "cache-control": "public, max-age=86400, stale-while-revalidate=604800" };
const LOGO_MISS_HEADERS = { "cache-control": "no-store, max-age=0" };
const API_CACHE_VERSION = "v3";
const FORECAST_CACHE_MAX_AGE_MS = 30 * 3600000;
const MAX_COMPARE_ASSETS = 5;
const FORECAST_COMPONENT_MODELS = ["Momentum", "Trend", "Mean Reversion", "Breakout", "Market Regime", "Orivane K-Line Structure", "Historical Analogs"] as const;
const BASE_COMPONENT_WEIGHTS: Record<typeof FORECAST_COMPONENT_MODELS[number], number> = {
  Momentum: 0.23,
  Trend: 0.2,
  "Mean Reversion": 0.16,
  Breakout: 0.11,
  "Market Regime": 0.08,
  "Orivane K-Line Structure": 0.14,
  "Historical Analogs": 0.08,
};
const SELF_OPTIMIZER_VERSION = "walk-forward-hedge-v2";
const SELF_OPTIMIZER_MIN_SAMPLES = 60;
const OFFICIAL_KRONOS_WEIGHT = 0.12;
const CONTEXTUAL_SIGNAL_WEIGHT = 0.05;
const KRONOS_SCHEMA_VERSION = "orivane-kronos-v1";
const MODEL_GOVERNANCE_VERSION = "model-governance-v1";
const GITHUB_OIDC_AUDIENCE = "orivane-kronos";
const GITHUB_OIDC_REPOSITORY = "Icehacker88/market-analyst";
const GEMINI_FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"];

function marketDataProvider(): string {
  return (process.env.ORIVANE_MARKET_DATA_PROVIDER || "free-yahoo-eastmoney").trim();
}

function configuredGeminiModel(): string {
  return (process.env.GEMINI_MODEL || "gemini-3.5-flash").trim().replace(/^['"]|['"]$/g, "");
}

function aiDailyLimit(): number {
  return Math.max(1, Number(process.env.ORIVANE_AI_DAILY_LIMIT || 20));
}

function adminEmails(): string[] {
  return (process.env.ORIVANE_ADMIN_EMAILS || "m18331893110@gmail.com")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

type CacheEntry<T> = {
  value: T;
  expires_at: number;
  stored_at: string;
};

const INFLIGHT_CACHE_LOADS = new Map<string, Promise<unknown>>();
const MEMORY_CACHE = new Map<string, CacheEntry<unknown>>();
const MEMORY_FORECASTS = new Map<string, Record<string, unknown>>();

function rememberValue<T>(key: string, entry: CacheEntry<T>): void {
  MEMORY_CACHE.set(key, entry);
  if (MEMORY_CACHE.size > 500) MEMORY_CACHE.delete(MEMORY_CACHE.keys().next().value as string);
}

function rememberForecast(symbol: string, forecast: Record<string, unknown>): void {
  MEMORY_FORECASTS.set(symbol.toUpperCase(), forecast);
  if (MEMORY_FORECASTS.size > 200) MEMORY_FORECASTS.delete(MEMORY_FORECASTS.keys().next().value as string);
}

type MetricsBucket = {
  date: string;
  requests: Record<string, { count: number; errors: number; total_ms: number; statuses: Record<string, number>; latency_samples?: number[] }>;
  cache: Record<string, { hit: number; miss: number; stale: number; error: number }>;
  events: Record<string, number>;
  web_vitals?: Record<string, { count: number; total: number; samples: number[] }>;
  updated_at: string;
};

const METRIC_SAMPLE_RATE = 0.1;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function error(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

function cachedJson(body: unknown, headers: HeadersInit = LONG_CACHE_HEADERS): Response {
  return new Response(JSON.stringify(body), { headers });
}

function privateJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: PRIVATE_HEADERS });
}

function cacheKey(value: string): string {
  return `${API_CACHE_VERSION}/${encodeURIComponent(value.trim().toLowerCase()).replace(/%/g, "~").slice(0, 520)}`;
}

function metricDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function emptyMetrics(date = metricDate()): MetricsBucket {
  return { date, requests: {}, cache: {}, events: {}, updated_at: new Date().toISOString() };
}

async function updateMetrics(update: (bucket: MetricsBucket) => void): Promise<void> {
  try {
    const store = getStore({ name: "orivane-api-metrics", consistency: "strong" });
    const key = `daily/${metricDate()}.json`;
    const bucket = await store.get(key, { type: "json" }) as MetricsBucket | null;
    const next = bucket ? { ...bucket, events: bucket.events || {} } : emptyMetrics();
    update(next);
    next.updated_at = new Date().toISOString();
    await store.setJSON(key, next);
  } catch {
    // Metrics must never break the user-facing API.
  }
}

async function recordRequestMetric(endpoint: string, status: number, durationMs: number): Promise<void> {
  await updateMetrics((bucket) => {
    const item = bucket.requests[endpoint] || { count: 0, errors: 0, total_ms: 0, statuses: {}, latency_samples: [] };
    item.count += 1;
    item.total_ms += durationMs;
    item.errors += status >= 400 ? 1 : 0;
    item.statuses[String(status)] = (item.statuses[String(status)] || 0) + 1;
    item.latency_samples = [...(item.latency_samples || []), durationMs].slice(-200);
    bucket.requests[endpoint] = item;
  });
}

async function recordCacheMetric(key: string, status: "hit" | "miss" | "stale" | "error"): Promise<void> {
  await updateMetrics((bucket) => {
    const item = bucket.cache[key] || { hit: 0, miss: 0, stale: 0, error: 0 };
    item[status] += 1;
    bucket.cache[key] = item;
  });
}

const PRODUCT_EVENTS = new Set([
  "search", "asset_view", "favorite_add", "favorite_remove", "alert_create", "login", "ai_question",
  "forecast_view", "forecast_evidence_open", "recommendation_open", "track_record_view",
  "comparison_view", "watchlist_view", "research_review_set", "research_review_complete", "onboarding_preference",
  "research_habit_cta", "portfolio_view", "screener_save", "screener_natural_query", "web_vitals",
]);

async function recordProductEvent(request: Request, context: Context): Promise<Response> {
  if (request.method !== "POST") return error(405, "method_not_allowed", "Method not allowed.");
  const body = await parseBody(request);
  const eventName = String(body.event || "");
  if (!PRODUCT_EVENTS.has(eventName)) return error(422, "validation_error", "Unknown event.");
  context.waitUntil(updateMetrics((bucket) => {
    if (eventName === "web_vitals") {
      bucket.web_vitals ||= {};
      const values = body.metrics && typeof body.metrics === "object" ? body.metrics as Record<string, unknown> : {};
      Object.entries(values).forEach(([name, rawValue]) => {
        const value = Number(rawValue);
        if (!["TTFB", "FCP", "LCP", "CLS", "LOAD"].includes(name) || !Number.isFinite(value) || value < 0) return;
        const item = bucket.web_vitals![name] || { count: 0, total: 0, samples: [] };
        item.count += 1;
        item.total += value;
        item.samples = [...item.samples, value].slice(-200);
        bucket.web_vitals![name] = item;
      });
      return;
    }
    bucket.events[eventName] = (bucket.events[eventName] || 0) + 1;
  }));
  return new Response(null, { status: 204, headers: PRIVATE_HEADERS });
}

function shouldRecordCacheMetric(status: "hit" | "miss" | "stale" | "error"): boolean {
  return status !== "hit";
}

function shouldRecordRequestMetric(endpoint: string, status: number): boolean {
  if (status >= 500) return true;
  if (endpoint === "GET /health" || endpoint === "GET /assets/logo" || endpoint === "GET /admin/metrics") return false;
  return [
    "GET /home",
    "GET /assets/search",
    "GET /market/history",
    "POST /compare",
    "GET /forecast/latest",
    "POST /forecast/run",
    "GET /company/research",
    "GET /screener",
    "GET /recommendations",
    "POST /alerts/test",
    "POST /alerts/process",
    "POST /events",
    "POST /ai/analysis",
  ].some((prefix) => endpoint.startsWith(prefix));
}

async function metricsSummary(): Promise<Record<string, unknown>> {
  const store = getStore({ name: "orivane-api-metrics", consistency: "strong" });
  const bucket = await store.get(`daily/${metricDate()}.json`, { type: "json" }) as MetricsBucket | null;
  const favoriteOptimizer = await store.get("optimizer/favorites/latest.json", { type: "json" }).catch(() => null);
  const requests = Object.fromEntries(Object.entries(bucket?.requests || {}).map(([endpoint, item]) => {
    const samples = [...(item.latency_samples || [])].sort((left, right) => left - right);
    const percentile = (ratio: number) => samples.length ? samples[Math.min(samples.length - 1, Math.ceil(samples.length * ratio) - 1)] : null;
    return [endpoint, { ...item, p50_ms: percentile(0.5), p75_ms: percentile(0.75), p95_ms: percentile(0.95) }];
  }));
  const webVitals = Object.fromEntries(Object.entries(bucket?.web_vitals || {}).map(([name, item]) => {
    const samples = [...item.samples].sort((left, right) => left - right);
    const percentile = (ratio: number) => samples.length ? samples[Math.min(samples.length - 1, Math.ceil(samples.length * ratio) - 1)] : null;
    return [name, { ...item, average: item.count ? item.total / item.count : null, p75: percentile(0.75), p95: percentile(0.95) }];
  }));
  return {
    provider: marketDataProvider(),
    paid_provider_ready: Boolean(process.env.POLYGON_API_KEY || process.env.FMP_API_KEY || process.env.TWELVE_DATA_API_KEY),
    metric_sample_rate: METRIC_SAMPLE_RATE,
    favorite_optimizer: favoriteOptimizer,
    ...(bucket || emptyMetrics()),
    requests,
    web_vitals: webVitals,
  };
}

function isAdminEmail(email?: string | null): boolean {
  return Boolean(email && adminEmails().includes(email.trim().toLowerCase()));
}

async function requireAdmin(request: Request, context: Context): Promise<boolean> {
  const user = await currentUser(request, context).catch(() => null);
  return isAdminEmail(user?.email);
}

async function cachedValue<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const store = getStore({ name: "orivane-api-cache" });
  const fullKey = cacheKey(key);
  const now = Date.now();
  const memory = MEMORY_CACHE.get(fullKey) as CacheEntry<T> | undefined;
  if (memory && memory.expires_at > now) {
    if (Math.random() < METRIC_SAMPLE_RATE) void recordCacheMetric(key, "hit");
    return memory.value;
  }
  const cached = await store.get(fullKey, { type: "json" }).catch(() => null) as CacheEntry<T> | null;
  if (cached && cached.expires_at > now) {
    if (Math.random() < METRIC_SAMPLE_RATE) void recordCacheMetric(key, "hit");
    rememberValue(fullKey, cached);
    return cached.value;
  }
  const inflight = INFLIGHT_CACHE_LOADS.get(fullKey);
  if (inflight) return inflight as Promise<T>;
  const cacheStatus = cached ? "stale" : "miss";
  const pending = (async () => {
    if (shouldRecordCacheMetric(cacheStatus) && Math.random() < METRIC_SAMPLE_RATE) void recordCacheMetric(key, cacheStatus);
    try {
      const value = await loader();
      const entry = { value, expires_at: now + ttlSeconds * 1000, stored_at: new Date(now).toISOString() };
      rememberValue(fullKey, entry);
      await store.setJSON(fullKey, entry).catch(() => undefined);
      return value;
    } catch (cause) {
      if (shouldRecordCacheMetric("error")) void recordCacheMetric(key, "error");
      if (cached) return cached.value;
      throw cause;
    }
  })();
  INFLIGHT_CACHE_LOADS.set(fullKey, pending);
  try {
    return await pending;
  } finally {
    if (INFLIGHT_CACHE_LOADS.get(fullKey) === pending) INFLIGHT_CACHE_LOADS.delete(fullKey);
  }
}

async function settleWithConcurrency<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: "fulfilled", value: await task(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function marketProviderHealth(): Promise<Record<string, unknown>> {
  const probe = async (url: string) => {
    const response = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(4500) });
    if (!response.ok) throw new Error(`Provider returned ${response.status}.`);
    return true;
  };
  const [yahoo, eastmoney] = await Promise.allSettled([
    probe("https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=5d&interval=1d"),
    probe(`https://searchapi.eastmoney.com/api/suggest/get?input=600519&type=14&token=${EASTMONEY_SEARCH_TOKEN}&count=1`),
  ]);
  const yahooAvailable = yahoo.status === "fulfilled";
  const eastmoneyAvailable = eastmoney.status === "fulfilled";
  return {
    status: yahooAvailable && eastmoneyAvailable ? "ok" : "degraded",
    yahoo_finance: yahooAvailable ? "available" : "unavailable",
    eastmoney_data: eastmoneyAvailable ? "available" : "unavailable",
    market_data_provider: marketDataProvider(),
    paid_provider_ready: Boolean(process.env.POLYGON_API_KEY || process.env.FMP_API_KEY || process.env.TWELVE_DATA_API_KEY),
    last_updated: new Date().toISOString(),
  };
}

async function providerHealthSnapshot(context: Context): Promise<Record<string, unknown>> {
  const key = cacheKey("health/providers-v2");
  const cached = MEMORY_CACHE.get(key) as CacheEntry<Record<string, unknown>> | undefined;
  if (cached?.expires_at && cached.expires_at > Date.now()) return cached.value;

  const store = getStore({ name: "orivane-api-cache" });
  const durable = await store.get(key, { type: "json" }).catch(() => null) as CacheEntry<Record<string, unknown>> | null;
  if (durable) {
    rememberValue(key, durable);
    if (durable.expires_at <= Date.now()) context.waitUntil(cachedValue("health/providers-v2", 5 * 60, marketProviderHealth).catch(() => undefined));
    return {
      ...durable.value,
      last_known: durable.expires_at <= Date.now(),
      probe_pending: durable.expires_at <= Date.now(),
    };
  }

  // Provider probes are useful diagnostics, but they should never block page chrome.
  context.waitUntil(cachedValue("health/providers-v2", 5 * 60, marketProviderHealth).catch(() => undefined));
  return {
    status: "checking",
    yahoo_finance: "checking",
    eastmoney_data: "checking",
    market_data_provider: marketDataProvider(),
    paid_provider_ready: Boolean(process.env.POLYGON_API_KEY || process.env.FMP_API_KEY || process.env.TWELVE_DATA_API_KEY),
    last_updated: new Date().toISOString(),
    probe_pending: true,
  };
}

function aliasKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function hasChinese(value?: string | null): boolean {
  return Boolean(value && /[\u3400-\u9fff]/.test(value));
}

function pinyinName(value: string): string {
  return pinyin(value, { toneType: "none", type: "array", nonZh: "consecutive" })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function cleanSecurityName(value: string): string {
  return value.replace(/^(?:XD|XR|DR)(?=[\u3400-\u9fff])/, "").trim();
}

function localizedAsset(asset: Asset): Asset {
  const catalog = CATALOG.find((item) => item.symbol === asset.symbol);
  const nameZh = asset.name_zh || ASSET_CHINESE_NAMES[asset.symbol] || (catalog && hasChinese(catalog.name) ? catalog.name : null) || (hasChinese(asset.name) ? cleanSecurityName(asset.name) : null);
  return {
    ...asset,
    name: nameZh && asset.name === asset.symbol ? nameZh : asset.name,
    name_zh: nameZh,
    name_pinyin: asset.name_pinyin || (nameZh ? pinyinName(nameZh) : null),
  };
}

function logoSymbol(symbol: string): string {
  return symbol.toUpperCase().endsWith(".SH") ? `${symbol.slice(0, -3)}.SS` : symbol.toUpperCase();
}

async function logoResponse(symbol: string | null): Promise<Response> {
  const clean = (symbol || "").toUpperCase().replace(/[^A-Z0-9.^=-]/g, "");
  if (!clean) return new Response(null, { status: 404, headers: LOGO_MISS_HEADERS });
  const key = `logos/${clean}.png`;
  const store = getStore({ name: "orivane-asset-logos" });
  const cached = await store.get(key, { type: "arrayBuffer" });
  if (cached) return new Response(cached, { headers: LOGO_HEADERS });
  const source = `https://financialmodelingprep.com/image-stock/${encodeURIComponent(logoSymbol(clean))}.png`;
  const response = await fetch(source, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(5000) });
  if (!response.ok || !response.headers.get("content-type")?.includes("image")) return new Response(null, { status: 404, headers: LOGO_MISS_HEADERS });
  const body = await response.arrayBuffer();
  if (body.byteLength < 100) return new Response(null, { status: 404, headers: LOGO_MISS_HEADERS });
  await store.set(key, body);
  return new Response(body, { headers: LOGO_HEADERS });
}

function inferAsset(value: string): Asset {
  const rawSymbol = ALIASES[aliasKey(value)] || value.trim().toUpperCase();
  const symbol = /^\d{6}$/.test(rawSymbol)
    ? `${rawSymbol}.${/^[569]/.test(rawSymbol) ? "SH" : "SZ"}`
    : rawSymbol;
  const catalog = CATALOG.find((item) => item.symbol === symbol);
  if (catalog) return localizedAsset(catalog);
  if (symbol.endsWith(".OF")) return localizedAsset({ symbol, name: symbol, asset_type: "fund", exchange: "OTC", currency: "CNY", data_source: "eastmoney" });
  if (symbol.endsWith(".HK")) return localizedAsset({ symbol, name: symbol, asset_type: "stock", exchange: "HKEX", currency: "HKD", data_source: "yahoo" });
  if (symbol.endsWith(".SH") || symbol.endsWith(".SZ") || symbol.endsWith(".BJ") || /^\d{6}$/.test(symbol)) {
    return localizedAsset({ symbol, name: symbol, asset_type: "stock", exchange: symbol.endsWith(".SH") || /^[569]/.test(symbol) ? "SSE" : "SZSE", currency: "CNY", data_source: "yahoo" });
  }
  if (symbol.startsWith("^")) return { symbol, name: symbol, asset_type: "index", currency: "USD", data_source: "yahoo" };
  if (symbol.endsWith("=X")) return { symbol, name: symbol, asset_type: "currency", exchange: "FX", data_source: "yahoo" };
  return { symbol, name: symbol, asset_type: "market", currency: "USD", data_source: "yahoo" };
}

function assetFromYahoo(item: Record<string, unknown>): Asset | null {
  if (!item.symbol) return null;
  const symbol = String(item.symbol).toUpperCase().replace(/\.SS$/, ".SH");
  const quoteType = String(item.quoteType || "market").toLowerCase();
  const assetType = ({ equity: "stock", etf: "etf", index: "index", mutualfund: "fund", currency: "currency" } as Record<string, Asset["asset_type"]>)[quoteType] || "market";
  return {
    symbol,
    name: String(item.longname || item.shortname || item.symbol),
    name_en: String(item.longname || item.shortname || item.symbol),
    asset_type: assetType,
    exchange: item.exchange ? String(item.exchange) : null,
    currency: item.currency ? String(item.currency) : null,
    data_source: "yahoo",
  };
}

function aShareSuffix(code: string, market?: string): "SH" | "SZ" | "BJ" {
  if (market === "1") return "SH";
  if (/^[4569]/.test(code)) return "SH";
  if (/^[48]/.test(code)) return "BJ";
  return "SZ";
}

function eastmoneyAsset(item: Record<string, unknown>): Asset | null {
  const code = String(item.Code || item.UnifiedCode || "").trim();
  const classify = String(item.Classify || "");
  const rawName = cleanSecurityName(String(item.Name || code));
  if (classify === "AStock" && /^\d{6}$/.test(code)) {
    const symbol = `${code}.${aShareSuffix(code, String(item.MktNum || ""))}`;
    const catalog = CATALOG.find((asset) => asset.symbol === symbol);
    const nameZh = catalog && hasChinese(catalog.name) ? catalog.name : rawName;
    return localizedAsset({
      symbol,
      name: nameZh,
      name_zh: nameZh,
      name_pinyin: pinyinName(nameZh),
      asset_type: "stock",
      exchange: symbol.endsWith(".SH") ? "SSE" : symbol.endsWith(".BJ") ? "BSE" : "SZSE",
      currency: "CNY",
      data_source: "yahoo",
    });
  }
  if (classify === "UsStock" && /^[A-Z][A-Z0-9.-]{0,14}$/i.test(code)) {
    const symbol = code.toUpperCase();
    const catalog = CATALOG.find((asset) => asset.symbol === symbol);
    const nameZh = ASSET_CHINESE_NAMES[symbol] || rawName;
    return localizedAsset({
      ...(catalog || {}),
      symbol,
      name: catalog?.name || nameZh,
      name_zh: nameZh,
      name_pinyin: pinyinName(nameZh),
      asset_type: String(item.TypeUS || "") === "5" ? "etf" : "stock",
      exchange: item.JYS ? String(item.JYS) : catalog?.exchange || null,
      currency: "USD",
      data_source: "yahoo",
    });
  }
  if (classify === "HK" && /^\d{4,5}$/.test(code) && String(item.TypeUS || "") === "3") {
    const normalizedCode = String(Number(code)).padStart(4, "0");
    const symbol = `${normalizedCode}.HK`;
    const catalog = CATALOG.find((asset) => asset.symbol === symbol);
    const nameZh = catalog && hasChinese(catalog.name) ? catalog.name : rawName;
    return localizedAsset({
      ...(catalog || {}),
      symbol,
      name: catalog?.name || nameZh,
      name_zh: nameZh,
      name_pinyin: pinyinName(nameZh),
      asset_type: "stock",
      exchange: "HKEX",
      currency: "HKD",
      data_source: "yahoo",
    });
  }
  if (classify === "Fund" && /^\d{6}$/.test(code)) {
    const market = aShareSuffix(code, String(item.MktNum || ""));
    const symbol = `${code}.${market}`;
    return localizedAsset({
      symbol,
      name: rawName,
      name_zh: rawName,
      name_pinyin: pinyinName(rawName),
      asset_type: "etf",
      exchange: market === "SH" ? "SSE" : market === "BJ" ? "BSE" : "SZSE",
      currency: "CNY",
      data_source: "yahoo",
    });
  }
  if (classify === "OTCFUND" && /^\d{6}$/.test(code)) {
    const symbol = `${code}.OF`;
    return localizedAsset({
      symbol,
      name: rawName,
      name_zh: rawName,
      name_pinyin: pinyinName(rawName),
      asset_type: "fund",
      exchange: "OTC",
      currency: "CNY",
      data_source: "eastmoney",
    });
  }
  return null;
}

async function eastmoneySearchAssets(query: string): Promise<Asset[]> {
  try {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(query)}&type=14&token=${EASTMONEY_SEARCH_TOKEN}&count=20`;
    const response = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error(`Eastmoney search returned ${response.status}.`);
    const payload = await response.json() as { QuotationCodeTable?: { Data?: Record<string, unknown>[] } };
    return (payload.QuotationCodeTable?.Data || []).map(eastmoneyAsset).filter((item): item is Asset => item !== null);
  } catch {
    return [];
  }
}

function matchesCatalog(item: Asset, term: string): boolean {
  const lowered = term.toLowerCase();
  const searchable = [item.symbol, item.name, item.name_zh, item.name_pinyin, hasChinese(item.name) ? pinyinName(item.name) : ""].join(" ").toLowerCase();
  return searchable.includes(lowered);
}

async function searchAssets(query: string): Promise<Asset[]> {
  const normalizedQuery = query.trim();
  const expandedTerms = SEARCH_EXPANSIONS[aliasKey(normalizedQuery)] || [];
  const terms = [normalizedQuery, ...expandedTerms];
  const matches = CATALOG.map(localizedAsset).filter((item) => terms.some((term) => matchesCatalog(item, term)));
  const recommended = SEARCH_RECOMMENDATIONS[aliasKey(normalizedQuery)] || [];
  recommended.slice().reverse().forEach((symbol) => matches.unshift(inferAsset(symbol)));
  const alias = ALIASES[aliasKey(query)];
  if (alias) matches.unshift(inferAsset(alias));
  const [eastmoneyResults, yahooResults] = await Promise.all([
    eastmoneySearchAssets(normalizedQuery),
    Promise.allSettled(terms.map(async (term) => {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(term)}&quotesCount=20&newsCount=0`;
    const response = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error(`Yahoo search returned ${response.status}.`);
    const payload = await response.json() as { quotes?: Record<string, unknown>[] };
    return (payload.quotes || []).map(assetFromYahoo).filter((item): item is Asset => item !== null);
    })),
  ]);
  matches.push(...eastmoneyResults);
  yahooResults.forEach((result) => {
    if (result.status === "fulfilled") matches.push(...result.value);
  });
  const directQuery = query.trim().toUpperCase();
  const exactEastmoneyCode = /^\d{6}$/.test(directQuery) && eastmoneyResults.some((item) => item.symbol.startsWith(`${directQuery}.`));
  if (DIRECT_SYMBOL_PATTERN.test(directQuery) && !exactEastmoneyCode) matches.push(await resolveAsset(query));
  return [...new Map(matches.map((item) => [item.symbol, localizedAsset(item)])).values()].slice(0, 30);
}

function isAShare(symbol: string): boolean {
  return /^\d{6}\.(SH|SZ|BJ)$/.test(symbol);
}

function eastmoneySecurityId(symbol: string): string {
  const [code, market] = symbol.split(".");
  return `${market === "SH" ? "1" : "0"}.${code}`;
}

async function eastmoneyQuoteId(symbol: string): Promise<string | null> {
  const upper = symbol.toUpperCase();
  if (isAShare(upper)) return eastmoneySecurityId(upper);
  if (/^\d{4}\.HK$/.test(upper)) return `116.${upper.slice(0, 4).padStart(5, "0")}`;
  try {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(upper.replace(/^\^/, ""))}&type=14&token=${EASTMONEY_SEARCH_TOKEN}&count=20`;
    const response = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(7000) });
    if (!response.ok) return null;
    const payload = await response.json() as { QuotationCodeTable?: { Data?: Array<{ Code?: string; UnifiedCode?: string; QuoteID?: string }> } };
    const rows = payload.QuotationCodeTable?.Data || [];
    const match = rows.find((row) => String(row.Code || "").toUpperCase() === upper || String(row.UnifiedCode || "").toUpperCase() === upper);
    return match?.QuoteID || null;
  } catch {
    return null;
  }
}

async function eastmoneyName(symbol: string): Promise<string | null> {
  if (!isAShare(symbol)) return null;
  const known = ASSET_CHINESE_NAMES[symbol];
  if (known) return known;
  return cachedValue(`assets/name-zh-v2/${symbol}`, 30 * 86400, async () => {
    try {
      const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${eastmoneySecurityId(symbol)}&fields=f57,f58`;
      const response = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(6000) });
      if (response.ok) {
        const payload = await response.json() as { data?: { f58?: string } };
        const quoteName = cleanSecurityName(String(payload.data?.f58 || ""));
        if (hasChinese(quoteName)) return quoteName;
      }
    } catch {
      // Fall through to the search endpoint, which is more reliable for newly listed assets.
    }
    const code = symbol.split(".")[0];
    const matches = await eastmoneySearchAssets(code);
    const match = matches.find((item) => item.symbol === symbol);
    const searchName = cleanSecurityName(String(match?.name_zh || ""));
    if (hasChinese(searchName)) return searchName;
    throw new Error(`Chinese security name unavailable for ${symbol}.`);
  }).catch(() => null);
}

async function yahooAsset(symbol: string): Promise<Asset | null> {
  try {
    const querySymbol = yahooMarketSymbol(symbol);
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(querySymbol)}&quotesCount=8&newsCount=0`;
    const response = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(6000) });
    const payload = await response.json() as { quotes?: Record<string, unknown>[] };
    const match = (payload.quotes || []).find((item) => String(item.symbol).toUpperCase() === querySymbol.toUpperCase());
    const asset = match ? assetFromYahoo(match) : null;
    return asset ? { ...asset, symbol, data_source: "yahoo" } : null;
  } catch {
    return null;
  }
}

async function resolveAsset(value: string): Promise<Asset> {
  const inferred = inferAsset(value);
  if (isAShare(inferred.symbol)) {
    const [cnName, yahoo] = await Promise.all([eastmoneyName(inferred.symbol), yahooAsset(inferred.symbol)]);
    const nameZh = ASSET_CHINESE_NAMES[inferred.symbol] || inferred.name_zh || (hasChinese(inferred.name) ? inferred.name : null) || cnName || null;
    return {
      ...inferred,
      ...yahoo,
      symbol: inferred.symbol,
      name: nameZh || (inferred.name !== inferred.symbol ? inferred.name : yahoo?.name) || inferred.name,
      name_zh: nameZh,
      name_pinyin: nameZh ? pinyinName(nameZh) : inferred.name_pinyin || null,
      data_source: "yahoo",
    };
  }
  if (inferred.asset_type === "fund") {
    const nameZh = await eastmoneyFundName(inferred.symbol) || inferred.name_zh || (hasChinese(inferred.name) ? inferred.name : null);
    return localizedAsset({ ...inferred, name: nameZh || inferred.name, name_zh: nameZh, name_pinyin: nameZh ? pinyinName(nameZh) : inferred.name_pinyin || null, data_source: "eastmoney" });
  }
  const known = CATALOG.some((item) => item.symbol === inferred.symbol);
  const eastmoneyLookup = inferred.symbol.endsWith(".HK")
    ? inferred.symbol.slice(0, -3).padStart(5, "0")
    : inferred.symbol;
  const [yahoo, eastmoneyMatches] = await Promise.all([
    yahooAsset(inferred.symbol),
    known ? Promise.resolve([] as Asset[]) : eastmoneySearchAssets(eastmoneyLookup),
  ]);
  const eastmoney = eastmoneyMatches.find((item) => item.symbol === inferred.symbol);
  const nameZh = inferred.name_zh || eastmoney?.name_zh || ASSET_CHINESE_NAMES[inferred.symbol] || null;
  return localizedAsset({
    ...inferred,
    ...eastmoney,
    ...yahoo,
    symbol: inferred.symbol,
    name: yahoo?.name || inferred.name,
    name_zh: nameZh,
    name_pinyin: nameZh ? pinyinName(nameZh) : inferred.name_pinyin || null,
    data_source: "yahoo",
  });
}

async function eastmoneyFundScript(symbol: string): Promise<string> {
  const code = symbol.toUpperCase().replace(/\.OF$/, "");
  const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`;
  const response = await fetch(url, {
    headers: { ...YAHOO_HEADERS, referer: `https://fund.eastmoney.com/${code}.html` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Eastmoney returned ${response.status}.`);
  return response.text();
}

async function eastmoneyFundName(symbol: string): Promise<string | null> {
  try {
    const script = await eastmoneyFundScript(symbol);
    return script.match(/var fS_name = "([^"]+)"/)?.[1] || null;
  } catch {
    return null;
  }
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values: number[], probability: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((sorted.length + 1) * probability) - 1));
  return sorted[index];
}

function movingAverage(values: number[], index: number, window: number): number | null {
  return index + 1 < window ? null : mean(values.slice(index + 1 - window, index + 1));
}

function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function pct(value: unknown): string {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : null;
  return numeric === null ? "—" : `${(numeric * 100).toFixed(2)}%`;
}

function stripHtml(value: unknown): string {
  return String(value || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function jsonpPayload(text: string): unknown {
  const match = text.match(/^[^(]*\(([\s\S]*)\)\s*;?$/);
  return JSON.parse(match ? match[1] : text) as unknown;
}

function cumulativeForecast(dailyReturn: number, days: number, persistence: number): number {
  let compounded = 1;
  for (let index = 0; index < days; index += 1) compounded *= 1 + dailyReturn * (persistence ** index);
  return clamp(compounded - 1, -0.6, 0.6);
}

function buildForecastPath(latestPrice: number, anchors: { d1: number; d5: number; d10: number; d22: number }): Array<Record<string, number | string>> {
  const cumulativeAt = (day: number) => {
    if (day <= 1) return anchors.d1;
    if (day <= 5) return anchors.d1 + (anchors.d5 - anchors.d1) * ((day - 1) / 4);
    if (day <= 10) return anchors.d5 + (anchors.d10 - anchors.d5) * ((day - 5) / 5);
    return anchors.d10 + (anchors.d22 - anchors.d10) * ((day - 10) / 12);
  };
  let previousCumulative = 0;
  return Array.from({ length: 22 }, (_, index) => {
    const day = index + 1;
    const cumulative = cumulativeAt(day);
    const predictedReturn = (1 + cumulative) / (1 + previousCumulative) - 1;
    previousCumulative = cumulative;
    return {
      Forecast_Day: day,
      Predicted_Return: predictedReturn,
      Predicted_Price: latestPrice * (1 + cumulative),
      Predicted_Direction: predictedReturn >= 0 ? "Up" : "Down",
      Cumulative_Return: cumulative,
    };
  });
}

function forecastComponent(model: string, forecasts: HorizonForecasts, weight: number, volatility: number, drivers_zh: string[], drivers_en: string[]): ForecastComponent {
  const forecast1d = clamp(forecasts.d1, -0.05, 0.05);
  return {
    model,
    forecast1d,
    forecast5d: clamp(forecasts.d5, -0.25, 0.25),
    forecast10d: clamp(forecasts.d10, -0.35, 0.35),
    forecast1m: clamp(forecasts.d22, -0.55, 0.55),
    weight,
    direction: forecast1d >= 0 ? "Up" : "Down",
    strength: volatility > 0 ? Math.min(3, Math.abs(forecast1d) / volatility) : 0,
    drivers_zh,
    drivers_en,
  };
}

function rowNumber(row: HistoryRecord, key: string, fallback: number | null = null): number | null {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : fallback;
}

function kronosKlineForecast(rows: HistoryRecord[], returns: number[], latestPrice: number, dailyVolatility: number, volumeRatio: number): KlineForecastSignal {
  const candles = rows.map((row, index) => {
    const close = rowNumber(row, "Close", rowNumber(row, "Price", latestPrice)) || latestPrice;
    const open = rowNumber(row, "Open", index ? rowNumber(rows[index - 1], "Close", rowNumber(rows[index - 1], "Price", close)) : close) || close;
    const high = Math.max(rowNumber(row, "High", close) || close, open, close);
    const low = Math.min(rowNumber(row, "Low", close) || close, open, close);
    const volume = rowNumber(row, "Volume", null);
    const range = Math.max(0, high - low);
    const body = close - open;
    const bodyReturn = open > 0 ? body / open : 0;
    const rangePct = close > 0 ? range / close : 0;
    const closeLocation = range > 0 ? (close - low) / range : 0.5;
    const upperWick = range > 0 ? (high - Math.max(open, close)) / range : 0;
    const lowerWick = range > 0 ? (Math.min(open, close) - low) / range : 0;
    const previousClose = index ? rowNumber(rows[index - 1], "Close", rowNumber(rows[index - 1], "Price", close)) || close : close;
    return {
      open,
      high,
      low,
      close,
      volume,
      range,
      bodyReturn,
      rangePct,
      closeLocation,
      upperWick,
      lowerWick,
      gapReturn: previousClose > 0 ? open / previousClose - 1 : 0,
    };
  });
  const recent = candles.slice(-20);
  const recent5 = candles.slice(-5);
  const latest = candles.at(-1)!;
  const volatilityScale = Math.max(0.004, dailyVolatility || standardDeviation(returns.slice(-20)) || 0.012);
  const averageRange20 = mean(recent.map((item) => item.rangePct)) || volatilityScale * 1.5;
  const averageRange5 = mean(recent5.map((item) => item.rangePct)) || averageRange20;
  const atr20 = mean(recent.map((item) => item.range)) || latest.close * volatilityScale;
  const volumeValues = recent.map((item) => item.volume).filter((value): value is number => Number.isFinite(value || NaN) && Number(value) > 0);
  const averageVolume20 = mean(volumeValues) || null;
  const rangeRatio = averageRange20 > 0 ? averageRange5 / averageRange20 : 1;
  const bodyPressure = mean(recent5.map((item, index) => item.bodyReturn * (index + 1))) || 0;
  const closePressure = mean(recent5.map((item) => (item.closeLocation - 0.5) * item.rangePct)) || 0;
  const patternScore = clamp((bodyPressure * 0.62 + closePressure * 0.38) / volatilityScale, -1, 1);
  const wickScore = clamp((latest.lowerWick - latest.upperWick) * latest.rangePct / volatilityScale, -1, 1);
  const high20 = Math.max(...recent.map((item) => item.high));
  const low20 = Math.min(...recent.map((item) => item.low));
  const rangePosition = high20 > low20 ? (latest.close - low20) / (high20 - low20) : 0.5;
  const rangeScore = clamp((rangePosition - 0.5) * 1.8 + (latest.close >= high20 * 0.998 ? 0.35 : latest.close <= low20 * 1.002 ? -0.35 : 0), -1, 1);
  const volumeScore = averageVolume20 && latest.volume
    ? clamp(Math.log(Math.max(0.1, latest.volume / averageVolume20)) * Math.sign(patternScore || rangeScore || returns.at(-1) || 1), -1, 1)
    : clamp((volumeRatio - 1) * Math.sign(patternScore || rangeScore || 1), -1, 1);
  const compressionScore = clamp((1 - rangeRatio) * Math.sign(rangeScore || patternScore || returns.at(-1) || 1), -0.8, 0.8);
  const gapScore = clamp(latest.gapReturn / volatilityScale, -0.7, 0.7);
  const score = clamp(patternScore * 0.32 + rangeScore * 0.24 + wickScore * 0.16 + volumeScore * 0.14 + compressionScore * 0.09 + gapScore * 0.05, -1, 1);
  const forecast1d = clamp(score * volatilityScale * 0.82, -1.35 * volatilityScale, 1.35 * volatilityScale);
  const forecastVolatility1m = clamp(Math.sqrt(averageRange20 ** 2 + volatilityScale ** 2) * Math.sqrt(22) * (rangeRatio > 1.25 ? 1.12 : rangeRatio < 0.75 ? 0.92 : 1), 0.015, 0.65);
  const labelZh = score > 0.35 ? "K线结构偏多" : score < -0.35 ? "K线结构偏空" : "K线结构中性";
  const labelEn = score > 0.35 ? "Bullish K-line structure" : score < -0.35 ? "Bearish K-line structure" : "Neutral K-line structure";
  return {
    model: "Orivane K-Line Structure",
    label_zh: labelZh,
    label_en: labelEn,
    score,
    forecast1d,
    pattern_score: patternScore,
    volume_score: volumeScore,
    range_score: rangeScore,
    reversal_score: wickScore,
    gap_score: gapScore,
    atr_20: atr20,
    range_ratio_5_20: rangeRatio,
    forecast_volatility_1m: forecastVolatility1m,
    drivers_zh: [
      `${labelZh}：近 5 根K线实体与收盘位置得分 ${patternScore.toFixed(2)}。`,
      `量价确认得分 ${volumeScore.toFixed(2)}，近 5/20 日振幅比 ${rangeRatio.toFixed(2)}。`,
      `最新K线下影/上影修正得分 ${wickScore.toFixed(2)}，ATR20 约 ${atr20.toFixed(2)}。`,
    ],
    drivers_en: [
      `${labelEn}: recent 5-candle body and close-location score is ${patternScore.toFixed(2)}.`,
      `Volume confirmation score is ${volumeScore.toFixed(2)} and 5/20-day range ratio is ${rangeRatio.toFixed(2)}.`,
      `Latest lower/upper wick adjustment is ${wickScore.toFixed(2)} and ATR20 is about ${atr20.toFixed(2)}.`,
    ],
  };
}

function historicalAnalogForecast(rows: HistoryRecord[], dailyVolatility: number): HistoricalAnalogSignal {
  const prices = rows.map((row) => Number(row.Price));
  const dailyReturns = prices.map((price, index) => index ? price / prices[index - 1] - 1 : 0);
  const vectors = prices.map((price, index) => {
    if (index < 50 || !Number.isFinite(price) || price <= 0) return null;
    const ma20 = Number(rows[index].MA_20) || mean(prices.slice(index - 19, index + 1)) || price;
    const ma50 = Number(rows[index].MA_50) || mean(prices.slice(index - 49, index + 1)) || ma20;
    const localVolatility = standardDeviation(dailyReturns.slice(Math.max(1, index - 19), index + 1)) || dailyVolatility || 0.012;
    const rsiValue = Number(rows[index].RSI_14);
    const macdValue = Number(rows[index].MACD_Hist);
    const volume = Number(rows[index].Volume);
    const recentVolumes = rows.slice(Math.max(0, index - 19), index + 1).map((row) => Number(row.Volume)).filter(Number.isFinite);
    const averageVolume = mean(recentVolumes) || volume || 1;
    const scaled = (value: number, denominator: number) => clamp(value / Math.max(denominator, 0.0001), -4, 4);
    return [
      scaled(dailyReturns[index], localVolatility),
      scaled(price / prices[index - 5] - 1, localVolatility * Math.sqrt(5)),
      scaled(price / prices[index - 20] - 1, localVolatility * Math.sqrt(20)),
      scaled(price / ma20 - 1, localVolatility * Math.sqrt(20)),
      scaled(ma20 / ma50 - 1, localVolatility * Math.sqrt(30)),
      Number.isFinite(rsiValue) ? clamp((rsiValue - 50) / 20, -2.5, 2.5) : 0,
      Number.isFinite(macdValue) ? scaled(macdValue / price, localVolatility) : 0,
      Number.isFinite(volume) && averageVolume > 0 ? clamp(Math.log(Math.max(0.1, volume / averageVolume)), -2, 2) : 0,
    ];
  });
  const currentIndex = rows.length - 1;
  const current = vectors[currentIndex];
  if (!current) {
    return { forecasts: { d1: 0, d5: 0, d10: 0, d22: 0 }, sample_size: 0, up_probability: { "1D": null, "5D": null, "10D": null, "1M": null }, drivers_zh: ["历史相似状态样本不足。"], drivers_en: ["Insufficient historical analog samples."] };
  }
  const horizons = [
    { label: "1D" as const, days: 1, key: "d1" as const },
    { label: "5D" as const, days: 5, key: "d5" as const },
    { label: "10D" as const, days: 10, key: "d10" as const },
    { label: "1M" as const, days: 22, key: "d22" as const },
  ];
  const forecasts: HorizonForecasts = { d1: 0, d5: 0, d10: 0, d22: 0 };
  const upProbability: HistoricalAnalogSignal["up_probability"] = { "1D": null, "5D": null, "10D": null, "1M": null };
  let minimumSample = Infinity;
  horizons.forEach(({ label, days, key }) => {
    const candidates = vectors
      .slice(0, Math.max(0, currentIndex - days + 1))
      .map((vector, index) => {
        if (!vector || index + days >= currentIndex) return null;
        const distance = mean(vector.map((value, featureIndex) => Math.abs(value - current[featureIndex]))) || 0;
        const actualReturn = prices[index + days] / prices[index] - 1;
        return Number.isFinite(actualReturn) ? { distance, actualReturn } : null;
      })
      .filter((item): item is { distance: number; actualReturn: number } => Boolean(item))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 35);
    minimumSample = Math.min(minimumSample, candidates.length);
    if (candidates.length < 12) return;
    const weighted = candidates.map((item) => ({ ...item, weight: 1 / (0.15 + item.distance) ** 2 }));
    const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
    const averageReturn = weighted.reduce((sum, item) => sum + item.actualReturn * item.weight, 0) / totalWeight;
    const probability = weighted.reduce((sum, item) => sum + (item.actualReturn >= 0 ? item.weight : 0), 0) / totalWeight;
    const sign = probability >= 0.5 ? 1 : -1;
    const probabilityMagnitude = dailyVolatility * Math.sqrt(days) * Math.abs(probability - 0.5) * 1.2;
    forecasts[key] = clamp(sign * Math.max(Math.abs(averageReturn) * 0.62, probabilityMagnitude), -dailyVolatility * Math.sqrt(days) * 2.2, dailyVolatility * Math.sqrt(days) * 2.2);
    upProbability[label] = probability * 100;
  });
  const sampleSize = Number.isFinite(minimumSample) ? minimumSample : 0;
  return {
    forecasts,
    sample_size: sampleSize,
    up_probability: upProbability,
    drivers_zh: [`从最近历史中匹配 ${sampleSize} 个最相似状态，分别估计各周期结果。`, `相似状态上涨比例：1日 ${upProbability["1D"]?.toFixed(1) ?? "—"}%、5日 ${upProbability["5D"]?.toFixed(1) ?? "—"}%、1个月 ${upProbability["1M"]?.toFixed(1) ?? "—"}%。`],
    drivers_en: [`Matched ${sampleSize} nearest historical states and estimated each horizon separately.`, `Analog up rates: 1D ${upProbability["1D"]?.toFixed(1) ?? "—"}%, 5D ${upProbability["5D"]?.toFixed(1) ?? "—"}% and 1M ${upProbability["1M"]?.toFixed(1) ?? "—"}%.`],
  };
}

function classifyMarketRegime(input: { recent20: number; ma20: number; ma50: number; dailyVolatility: number; volumeRatio: number; context?: ForecastContext }): ForecastMarketRegime {
  const trendSpread = input.ma50 ? input.ma20 / input.ma50 - 1 : 0;
  const regime: ForecastMarketRegime["regime"] = input.dailyVolatility > 0.035
    ? "high_volatility"
    : trendSpread > 0.015 && input.recent20 > 0
      ? "trend_up"
      : trendSpread < -0.015 && input.recent20 < 0
        ? "trend_down"
        : "range";
  const labels = {
    trend_up: ["趋势上行", "Uptrend"],
    trend_down: ["趋势下行", "Downtrend"],
    range: ["震荡整理", "Range-bound"],
    high_volatility: ["高波动", "High volatility"],
  } as const;
  return {
    regime,
    label_zh: labels[regime][0],
    label_en: labels[regime][1],
    daily_volatility: input.dailyVolatility,
    volume_ratio: input.volumeRatio,
    benchmark_symbol: input.context?.benchmark_symbol || null,
    benchmark_return_5d: input.context?.benchmark_return_5d ?? null,
    benchmark_return_20d: input.context?.benchmark_return_20d ?? null,
  };
}

function buildKeyLevels(input: {
  latestPrice: number;
  ma20: number;
  ma50: number;
  low20: number;
  high20: number;
  dailyVolatility: number;
  forecast1m: number;
}): ForecastKeyLevels {
  const volatilityStop = input.latestPrice * (1 - Math.max(0.035, input.dailyVolatility * 2.4));
  const supportCandidates = [input.ma20, input.low20, input.ma50].filter((value) => Number.isFinite(value) && value > 0);
  const resistanceCandidates = [input.high20, input.ma20, input.ma50].filter((value) => Number.isFinite(value) && value > input.latestPrice * 0.98);
  const support = supportCandidates.length ? Math.max(...supportCandidates.filter((value) => value <= input.latestPrice * 1.01)) || Math.min(...supportCandidates) : null;
  const resistance = resistanceCandidates.length ? Math.max(...resistanceCandidates) : null;
  const stopLoss = Number.isFinite(input.low20) ? Math.min(input.low20, volatilityStop) : volatilityStop;
  const breakout = Number.isFinite(input.high20) ? input.high20 * 1.01 : null;
  const invalidation = input.forecast1m >= 0
    ? Math.min(...[input.ma20, input.low20, stopLoss].filter((value) => Number.isFinite(value) && value > 0))
    : Math.max(...[input.ma20, input.high20].filter((value) => Number.isFinite(value) && value > 0));
  return {
    support,
    resistance,
    stop_loss: stopLoss,
    breakout,
    invalidation,
    invalidation_zh: input.forecast1m >= 0
      ? `若有效跌破 ${Number.isFinite(invalidation) ? invalidation.toFixed(2) : "关键支撑"}，当前偏多预测失效概率上升。`
      : `若有效站回 ${Number.isFinite(invalidation) ? invalidation.toFixed(2) : "关键压力"} 上方，当前偏空预测需要重新评估。`,
    invalidation_en: input.forecast1m >= 0
      ? `A confirmed break below ${Number.isFinite(invalidation) ? invalidation.toFixed(2) : "key support"} raises the failure risk of the bullish forecast.`
      : `A confirmed reclaim above ${Number.isFinite(invalidation) ? invalidation.toFixed(2) : "key resistance"} would require reassessing the bearish forecast.`,
  };
}

function buildForecastAction(
  forecast1m: number,
  confidenceScore: number,
  keyLevels: ForecastKeyLevels,
  evidence?: {
    backtest_samples?: number;
    backtest_edge?: number | null;
    calibration_samples?: number;
    calibration_hit_rate?: number | null;
    live_samples?: number;
    live_edge?: number | null;
    fresh?: boolean;
  },
): ForecastAction {
  const samples = evidence?.backtest_samples || 0;
  const edge = evidence?.backtest_edge ?? null;
  const calibrationSamples = evidence?.calibration_samples || 0;
  const calibrationHitRate = evidence?.calibration_hit_rate ?? null;
  const liveSamples = evidence?.live_samples || 0;
  const liveEdge = evidence?.live_edge ?? null;
  const fresh = evidence?.fresh !== false;
  const hasValidation = samples >= 60 && calibrationSamples >= 20;
  const positiveEdge = edge !== null && edge >= 2;
  const calibrated = calibrationHitRate !== null && calibrationHitRate >= 52;
  const liveContradicts = liveSamples >= 20 && (liveEdge === null || liveEdge <= 0);
  if (!fresh || !hasValidation || !positiveEdge || !calibrated || liveContradicts) {
    const evidenceStatus: ForecastAction["evidence_status"] = !fresh || !hasValidation
      ? "insufficient"
      : !positiveEdge || liveContradicts
        ? "negative_edge"
        : "provisional";
    const reasonZh = !fresh
      ? "行情日期已晚于该预测，等待按最新交易日重新计算。"
      : !hasValidation
        ? `数值预测已生成，但独立走步验证或相似样本尚未达到操作门槛（${samples}/60，${calibrationSamples}/20）。`
        : !positiveEdge
          ? `数值预测已生成，但走步验证相对多数类基准的优势为 ${edge?.toFixed(1) ?? "—"} 个百分点，暂不形成仓位建议。`
          : liveContradicts
            ? `数值预测已生成，但最近 ${liveSamples} 次真实冻结预测相对多数类基准的优势为 ${liveEdge?.toFixed(1) ?? "—"} 个百分点，暂不形成仓位建议。`
          : `数值预测已生成，但相似样本命中率 ${calibrationHitRate?.toFixed(1) ?? "—"}% 尚未达到操作门槛。`;
    const reasonEn = !fresh
      ? "Market data is newer than this forecast; wait for a current-session recalculation."
      : !hasValidation
        ? `Numeric forecasts are available, but walk-forward or similar-signal evidence is below the action threshold (${samples}/60, ${calibrationSamples}/20).`
        : !positiveEdge
          ? `Numeric forecasts are available, but walk-forward edge versus the majority baseline is ${edge?.toFixed(1) ?? "—"} percentage points, so no position call is issued.`
          : liveContradicts
            ? `Numeric forecasts are available, but the latest ${liveSamples} frozen forecasts have an edge of ${liveEdge?.toFixed(1) ?? "—"} percentage points versus the majority baseline, so no position call is issued.`
          : `Numeric forecasts are available, but the similar-signal hit rate of ${calibrationHitRate?.toFixed(1) ?? "—"}% is below the action threshold.`;
    return {
      stance: "wait",
      actionable: false,
      evidence_status: evidenceStatus,
      label_zh: "仅作方向观察",
      label_en: "Directional watch only",
      summary_zh: reasonZh,
      summary_en: reasonEn,
      abstain_reason_zh: reasonZh,
      abstain_reason_en: reasonEn,
    };
  }
  if (forecast1m > 0.035 && confidenceScore >= 62) {
    return {
      stance: "accumulate",
      actionable: true,
      evidence_status: "validated",
      label_zh: "回调分批关注",
      label_en: "Accumulate on pullbacks",
      summary_zh: `趋势和预测偏强，优先等回踩支撑位 ${keyLevels.support?.toFixed(2) || "附近"} 后分批，而不是直接追高。`,
      summary_en: `Trend and forecast are constructive; prefer staged entries near support around ${keyLevels.support?.toFixed(2) || "the support zone"} rather than chasing.`,
    };
  }
  if (forecast1m < -0.035 && confidenceScore >= 58) {
    return {
      stance: "reduce",
      actionable: true,
      evidence_status: "validated",
      label_zh: "控制仓位风险",
      label_en: "Reduce risk",
      summary_zh: `预测转弱，优先看能否重新站回压力位 ${keyLevels.resistance?.toFixed(2) || "上方"}，否则不宜追涨。`,
      summary_en: `Forecast is weakening; first watch whether price can reclaim resistance near ${keyLevels.resistance?.toFixed(2) || "the resistance zone"}.`,
    };
  }
  if (forecast1m > 0) {
    return {
      stance: "hold",
      actionable: true,
      evidence_status: "validated",
      label_zh: "轻仓跟踪",
      label_en: "Track with caution",
      summary_zh: "预测轻度偏正，但强度不足，适合结合成交量和关键价位确认。",
      summary_en: "Forecast is mildly positive but not strong; confirm with volume and key levels.",
    };
  }
  return {
    stance: "wait",
    actionable: true,
    evidence_status: "validated",
    label_zh: "等待确认",
    label_en: "Wait for confirmation",
    summary_zh: "预测强度一般或偏弱，先观察风险释放和趋势修复。",
    summary_en: "Forecast is moderate or weak; wait for risk to clear and trend to repair.",
  };
}

function buildForecastScenarios(latestPrice: number, forecast1m: number, dailyVolatility: number, agreementRatio: number): ForecastScenario[] {
  const scenarioWidth = Math.max(0.025, dailyVolatility * Math.sqrt(22) * 1.15);
  const baseProbability = Math.round(clamp(44 + agreementRatio * 18, 42, 62));
  const bullProbability = Math.round((100 - baseProbability) * (forecast1m >= 0 ? 0.58 : 0.42));
  const bearProbability = 100 - baseProbability - bullProbability;
  const bullReturn = clamp(forecast1m + scenarioWidth, -0.55, 0.75);
  const bearReturn = clamp(forecast1m - scenarioWidth, -0.65, 0.55);
  return [
    {
      name: "bull",
      label_zh: "乐观情景",
      label_en: "Bull case",
      probability: bullProbability,
      calibrated: false,
      expected_return: bullReturn,
      expected_price: latestPrice * (1 + bullReturn),
      narrative_zh: "价格站稳均线并突破近期高点，成交量配合，预测上沿更容易实现。",
      narrative_en: "Price holds moving averages, breaks recent highs and volume confirms; the upper forecast path becomes more likely.",
    },
    {
      name: "base",
      label_zh: "基准情景",
      label_en: "Base case",
      probability: baseProbability,
      calibrated: false,
      expected_return: forecast1m,
      expected_price: latestPrice * (1 + forecast1m),
      narrative_zh: "维持当前趋势与波动水平，按组合模型的中性路径运行。",
      narrative_en: "Current trend and volatility persist, following the ensemble's central path.",
    },
    {
      name: "bear",
      label_zh: "悲观情景",
      label_en: "Bear case",
      probability: bearProbability,
      calibrated: false,
      expected_return: bearReturn,
      expected_price: latestPrice * (1 + bearReturn),
      narrative_zh: "跌破关键支撑或放量下跌，预测失效并转向下沿。",
      narrative_en: "Price breaks key support or sells off on volume; the forecast shifts toward the lower path.",
    },
  ];
}

function defaultMultipliers(): Record<string, number> {
  return Object.fromEntries(FORECAST_COMPONENT_MODELS.map((model) => [model, 1])) as Record<string, number>;
}

function neutralForecastOptimization(dataAsOf?: string | null, reason = "样本不足，暂不调整模型权重。"): ForecastOptimization {
  return {
    version: SELF_OPTIMIZER_VERSION,
    active: false,
    source: "fallback",
    generated_at: new Date().toISOString(),
    data_as_of: dataAsOf || null,
    sample_size: 0,
    min_sample_size: SELF_OPTIMIZER_MIN_SAMPLES,
    ai_model: null,
    component_multipliers: defaultMultipliers(),
    confidence_delta: 0,
    applied_weight_shift: 0,
    notes_zh: [reason],
    notes_en: ["Automatic weight tuning is inactive; the validated baseline weights remain in use."],
  };
}

function sanitizeMultipliers(value: unknown): Record<string, number> {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const aliases: Record<string, string> = {
    momentum: "Momentum",
    trend: "Trend",
    mean_reversion: "Mean Reversion",
    breakout: "Breakout",
    market_regime: "Market Regime",
    kline: "Orivane K-Line Structure",
    kronos: "Orivane K-Line Structure",
    kronos_kline: "Orivane K-Line Structure",
    "kronos k-line": "Orivane K-Line Structure",
    "orivane k-line structure": "Orivane K-Line Structure",
    analog: "Historical Analogs",
    analogs: "Historical Analogs",
    historical_analogs: "Historical Analogs",
  };
  const multipliers = defaultMultipliers();
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const model = aliases[rawKey] || rawKey;
    if (!FORECAST_COMPONENT_MODELS.includes(model as typeof FORECAST_COMPONENT_MODELS[number])) continue;
    const numeric = Number(rawValue);
    if (Number.isFinite(numeric)) multipliers[model] = clamp(numeric, 0.65, 1.35);
  }
  return multipliers;
}

function weightedValidationStats(rows: Array<Record<string, unknown>>, multipliers: Record<string, number>): { samples: number; accuracy: number | null; baseline: number | null; edge: number | null } {
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  rows.forEach((row) => {
    const model = String(row.Best_Model || "");
    if (!FORECAST_COMPONENT_MODELS.includes(model as typeof FORECAST_COMPONENT_MODELS[number])) return;
    if (toNumber(row.Actual_1D_Return) === null || toNumber(row.Forecast_1D_Return) === null) return;
    const date = String(row.As_Of_Date || "");
    grouped.set(date, [...(grouped.get(date) || []), row]);
  });
  const evaluations = [...grouped.values()].map((items) => {
    const actual = toNumber(items[0]?.Actual_1D_Return);
    if (actual === null) return null;
    let weightedForecast = 0;
    let weightTotal = 0;
    items.forEach((item) => {
      const model = String(item.Best_Model) as typeof FORECAST_COMPONENT_MODELS[number];
      const weight = BASE_COMPONENT_WEIGHTS[model] * (multipliers[model] || 1);
      weightedForecast += weight * Number(item.Forecast_1D_Return || 0);
      weightTotal += weight;
    });
    if (!weightTotal) return null;
    const forecast = weightedForecast / weightTotal;
    return { actual, correct: directionFromReturn(forecast) === directionFromReturn(actual) ? 1 : 0 };
  }).filter((item): item is { actual: number; correct: number } => Boolean(item));
  if (!evaluations.length) return { samples: 0, accuracy: null, baseline: null, edge: null };
  const accuracy = mean(evaluations.map((item) => item.correct))! * 100;
  const upRate = evaluations.filter((item) => item.actual >= 0).length / evaluations.length * 100;
  const baseline = Math.max(upRate, 100 - upRate);
  return { samples: evaluations.length, accuracy, baseline, edge: accuracy - baseline };
}

function historyOptimizationProfile(symbol: string, modelRows: Array<Record<string, unknown>>, dataAsOf?: string | null): ForecastOptimization {
  const completedDates = [...new Set(modelRows
    .filter((row) => toNumber(row.Actual_1D_Return) !== null)
    .map((row) => String(row.As_Of_Date || ""))
    .filter(Boolean))].sort();
  const sampleSize = completedDates.length;
  const holdoutSize = Math.max(20, Math.floor(sampleSize * 0.3));
  const cutoff = completedDates[Math.max(0, completedDates.length - holdoutSize)] || "";
  const trainingRows = modelRows.filter((row) => String(row.As_Of_Date || "") < cutoff);
  const holdoutRows = modelRows.filter((row) => String(row.As_Of_Date || "") >= cutoff);
  const summaries = FORECAST_COMPONENT_MODELS.map((model) => summarizeModelRows(model, trainingRows));
  const valid = summaries.filter((item) => Number(item.Samples || 0) >= 30);
  if (sampleSize < SELF_OPTIMIZER_MIN_SAMPLES || valid.length < 3 || holdoutSize < 20) {
    return { ...neutralForecastOptimization(dataAsOf), source: "history", sample_size: sampleSize, diagnostics: { symbol, reason: "low_sample", model_count: valid.length } };
  }
  const rmseBase = median(valid.map((item) => toNumber(item.Return_RMSE)).filter((value): value is number => value !== null)) || 0.02;
  const losses = valid.map((item) => {
    const accuracy = (toNumber(item.Directional_Accuracy) ?? 50) / 100;
    const rmse = toNumber(item.Return_RMSE) ?? rmseBase;
    const normalizedError = rmseBase > 0 ? rmse / rmseBase : 1;
    const loss = (1 - accuracy) * 0.68 + normalizedError * 0.32;
    return { model: String(item.Model), loss, accuracy, rmse, samples: Number(item.Samples || 0) };
  });
  const medianLoss = median(losses.map((item) => item.loss)) || 0;
  const multipliers = defaultMultipliers();
  losses.forEach((item) => {
    multipliers[item.model] = clamp(Math.exp(-2.4 * (item.loss - medianLoss)), 0.65, 1.35);
  });
  const baselineStats = weightedValidationStats(holdoutRows, defaultMultipliers());
  const optimizedStats = weightedValidationStats(holdoutRows, multipliers);
  const improvesHoldout = optimizedStats.edge !== null
    && optimizedStats.edge > 0
    && optimizedStats.accuracy !== null
    && baselineStats.accuracy !== null
    && optimizedStats.accuracy >= baselineStats.accuracy;
  if (!improvesHoldout) {
    return {
      ...neutralForecastOptimization(dataAsOf, "候选调权未通过独立留出段，继续使用基准权重。"),
      source: "history",
      sample_size: sampleSize,
      diagnostics: { symbol, training_samples: sampleSize - holdoutSize, holdout: optimizedStats, baseline_holdout: baselineStats, model_losses: losses },
    };
  }
  const confidenceDelta = Math.round(clamp((optimizedStats.edge || 0) / 3, 0, 4));
  return {
    version: SELF_OPTIMIZER_VERSION,
    active: true,
    source: "history",
    generated_at: new Date().toISOString(),
    data_as_of: dataAsOf || null,
    sample_size: sampleSize,
    min_sample_size: SELF_OPTIMIZER_MIN_SAMPLES,
    ai_model: null,
    component_multipliers: multipliers,
    confidence_delta: confidenceDelta,
    notes_zh: [
      `基于 ${sampleSize - holdoutSize} 个训练样本生成权重，并通过 ${optimizedStats.samples} 个独立留出样本复核。`,
      `留出段方向优势 ${(optimizedStats.edge || 0).toFixed(1)} 个百分点；未通过时系统会自动回退基准权重。`,
    ],
    notes_en: [
      `Weights were learned from ${sampleSize - holdoutSize} training samples and checked on ${optimizedStats.samples} independent holdout samples.`,
      `Holdout directional edge is ${(optimizedStats.edge || 0).toFixed(1)} percentage points; failed candidates automatically revert to baseline weights.`,
    ],
    diagnostics: { symbol, training_samples: sampleSize - holdoutSize, holdout: optimizedStats, baseline_holdout: baselineStats, model_losses: losses },
  };
}

function trendForecast(history: { snapshot: Record<string, number | null>; records: HistoryRecord[]; context?: ForecastContext; optimization?: ForecastOptimization }): TrendForecast {
  const rows = history.records
    .filter((row) => Number.isFinite(Number(row.Price)))
    .sort((left, right) => String(left.Date).localeCompare(String(right.Date)));
  const prices = rows.map((row) => Number(row.Price));
  if (prices.length < 60) throw new Error("Insufficient history for a cloud forecast.");
  const returns = prices.map((price, index) => index ? price / prices[index - 1] - 1 : 0).slice(1);
  const latestRow = rows.at(-1)!;
  const latestPrice = prices.at(-1)!;
  const recent5 = mean(returns.slice(-5)) || 0;
  const recent10 = mean(returns.slice(-10)) || 0;
  const recent20 = mean(returns.slice(-20)) || 0;
  const recent60 = mean(returns.slice(-60)) || recent20;
  const returnFor = (days: number) => prices.length > days ? latestPrice / prices[prices.length - days - 1] - 1 : (mean(returns.slice(-days)) || 0) * days;
  const return5 = returnFor(5);
  const return10 = returnFor(10);
  const return20 = returnFor(20);
  const return60 = returnFor(60);
  const ma20 = Number(latestRow.MA_20) || mean(prices.slice(-20)) || latestPrice;
  const ma50 = Number(latestRow.MA_50) || mean(prices.slice(-50)) || ma20;
  const dailyVolatility = Number(history.snapshot.annualized_volatility_20d || 0) / Math.sqrt(252) || standardDeviation(returns.slice(-20)) || 0.012;
  const rsiValue = Number(latestRow.RSI_14);
  const macdHist = Number(latestRow.MACD_Hist);
  const volumes = rows.map((row) => Number(row.Volume)).filter(Number.isFinite);
  const latestVolume = Number(latestRow.Volume);
  const averageVolume20 = mean(volumes.slice(-20)) || null;
  const volumeRatio = Number.isFinite(latestVolume) && averageVolume20 ? latestVolume / averageVolume20 : 1;
  const recent20Prices = prices.slice(-20);
  const high20 = recent20Prices.length ? Math.max(...recent20Prices) : latestPrice;
  const low20 = recent20Prices.length ? Math.min(...recent20Prices) : latestPrice;
  const rangePosition = high20 > low20 ? (latestPrice - low20) / (high20 - low20) : 0.5;
  const volatilityScale = dailyVolatility || Math.max(0.004, Math.abs(recent5), Math.abs(recent20));
  const marketRegime = classifyMarketRegime({ recent20, ma20, ma50, dailyVolatility, volumeRatio, context: history.context });
  const benchmark5d = typeof history.context?.benchmark_return_5d === "number" ? history.context.benchmark_return_5d : null;
  const benchmark20d = typeof history.context?.benchmark_return_20d === "number" ? history.context.benchmark_return_20d : null;
  const marketDaily = clamp(((benchmark5d ?? recent5 * 5) / 5) * 0.22 + ((benchmark20d ?? recent20 * 20) / 20) * 0.1, -0.18 * volatilityScale, 0.18 * volatilityScale);
  const klineForecast = kronosKlineForecast(rows, returns, latestPrice, dailyVolatility, volumeRatio);
  const analogForecast = historicalAnalogForecast(rows, dailyVolatility);

  const momentumDaily = recent5 * 0.46 + recent10 * 0.28 + recent20 * 0.18 + recent60 * 0.08;
  const trendSlope = (latestPrice / ma20 - 1) / 9 + (ma20 / ma50 - 1) / 18;
  const trendDaily = trendSlope
    + (Number.isFinite(macdHist) && latestPrice ? clamp((macdHist / latestPrice) * 0.22, -0.12 * volatilityScale, 0.12 * volatilityScale) : 0)
    + (volumeRatio > 1.2 ? Math.sign(trendSlope || recent20 || 1) * 0.035 * volatilityScale : 0);
  const rsiMeanReversion = Number.isFinite(rsiValue)
    ? rsiValue > 72
      ? -0.24 * volatilityScale
      : rsiValue < 28
        ? 0.24 * volatilityScale
        : (50 - rsiValue) / 50 * 0.035 * volatilityScale
    : 0;
  const meanReversionDaily = clamp(-(latestPrice / ma20 - 1) / 16 + rsiMeanReversion, -0.8 * volatilityScale, 0.8 * volatilityScale);
  const breakoutDaily = (rangePosition - 0.5) * 0.5 * volatilityScale
    + (latestPrice >= high20 * 0.995 ? 0.12 * volatilityScale : latestPrice <= low20 * 1.005 ? -0.12 * volatilityScale : 0)
    + (volumeRatio > 1.25 ? Math.sign(rangePosition - 0.5 || recent5 || 1) * 0.04 * volatilityScale : 0);

  const horizonCap = (value: number, days: number, scale = 2.2) => clamp(value, -dailyVolatility * Math.sqrt(days) * scale, dailyVolatility * Math.sqrt(days) * scale);
  const momentumForecasts: HorizonForecasts = {
    d1: momentumDaily,
    d5: horizonCap(return5 * 0.5 + return10 * 0.15 + return20 * 0.04, 5),
    d10: horizonCap(return10 * 0.5 + return20 * 0.2 + return60 * 0.04, 10),
    d22: horizonCap(return20 * 0.52 + return60 * 0.15 + return10 * 0.08, 22),
  };
  const trendDeviation = latestPrice / ma20 - 1;
  const movingAverageSpread = ma20 / ma50 - 1;
  const trendForecasts: HorizonForecasts = {
    d1: trendDaily,
    d5: horizonCap(trendDeviation * 0.28 + movingAverageSpread * 0.18 + trendDaily * 2.2, 5),
    d10: horizonCap(trendDeviation * 0.36 + movingAverageSpread * 0.32 + trendDaily * 3.1, 10),
    d22: horizonCap(trendDeviation * 0.42 + movingAverageSpread * 0.55 + trendDaily * 4.2, 22),
  };
  const meanReversionForecasts: HorizonForecasts = {
    d1: meanReversionDaily,
    d5: horizonCap(-trendDeviation * 0.34 + rsiMeanReversion * 3.2, 5, 1.7),
    d10: horizonCap(-trendDeviation * 0.48 + rsiMeanReversion * 4.4, 10, 1.7),
    d22: horizonCap(-trendDeviation * 0.68 + rsiMeanReversion * 5.5, 22, 1.7),
  };
  const breakoutForecasts: HorizonForecasts = {
    d1: breakoutDaily,
    d5: horizonCap(breakoutDaily * 3 + (rangePosition - 0.5) * dailyVolatility * 1.2, 5),
    d10: horizonCap(breakoutDaily * 4.2 + (rangePosition - 0.5) * dailyVolatility * 1.8, 10),
    d22: horizonCap(breakoutDaily * 5.2 + (rangePosition - 0.5) * dailyVolatility * 2.3, 22),
  };
  const marketForecasts: HorizonForecasts = {
    d1: marketDaily,
    d5: horizonCap((benchmark5d ?? return5) * 0.28 + return5 * 0.08, 5, 1.5),
    d10: horizonCap((benchmark5d ?? return5) * 0.35 + (benchmark20d ?? return20) * 0.12, 10, 1.5),
    d22: horizonCap((benchmark20d ?? return20) * 0.32 + return20 * 0.08, 22, 1.5),
  };
  const klineForecasts: HorizonForecasts = {
    d1: klineForecast.forecast1d,
    d5: horizonCap(klineForecast.forecast1d * 2.8, 5, 1.6),
    d10: horizonCap(klineForecast.forecast1d * 3.8, 10, 1.6),
    d22: horizonCap(klineForecast.forecast1d * 4.8, 22, 1.6),
  };

  const baseWeights: Record<string, number> = { ...BASE_COMPONENT_WEIGHTS };
  if (analogForecast.sample_size < 20) {
    baseWeights["Historical Analogs"] = 0.05;
    baseWeights.Momentum += 0.01;
    baseWeights.Trend += 0.01;
    baseWeights["Mean Reversion"] += 0.01;
  }
  if (Number.isFinite(rsiValue) && (rsiValue > 70 || rsiValue < 30)) {
    baseWeights["Mean Reversion"] += 0.06;
    baseWeights.Momentum -= 0.03;
    baseWeights.Breakout -= 0.02;
    baseWeights["Orivane K-Line Structure"] -= 0.01;
  }
  if (volumeRatio > 1.2) {
    baseWeights.Breakout += 0.04;
    baseWeights.Trend += 0.02;
    baseWeights["Orivane K-Line Structure"] += 0.03;
    baseWeights["Mean Reversion"] -= 0.03;
    baseWeights.Momentum -= 0.04;
    baseWeights["Market Regime"] -= 0.02;
  }
  if (dailyVolatility > 0.03) {
    baseWeights["Mean Reversion"] += 0.03;
    baseWeights["Orivane K-Line Structure"] += 0.02;
    baseWeights.Momentum -= 0.03;
    baseWeights.Trend -= 0.01;
    baseWeights["Market Regime"] -= 0.01;
  }
  if (marketRegime.regime === "trend_up" || marketRegime.regime === "trend_down") {
    baseWeights.Trend += 0.03;
    baseWeights["Market Regime"] += 0.03;
    baseWeights["Mean Reversion"] -= 0.03;
    baseWeights.Momentum -= 0.02;
    baseWeights["Orivane K-Line Structure"] -= 0.01;
  } else if (marketRegime.regime === "range") {
    baseWeights["Mean Reversion"] += 0.03;
    baseWeights.Breakout -= 0.02;
    baseWeights["Orivane K-Line Structure"] += 0.01;
    baseWeights["Market Regime"] -= 0.01;
  }
  const baselineTotal = Object.values(baseWeights).reduce((sum, value) => sum + Math.max(0.05, value), 0);
  const baselineWeights = Object.fromEntries(Object.entries(baseWeights).map(([key, value]) => [key, Math.max(0.05, value) / baselineTotal])) as Record<string, number>;
  const rawOptimization = history.optimization || neutralForecastOptimization(String(latestRow.Date || ""));
  const optimizationMultipliers = rawOptimization.active ? sanitizeMultipliers(rawOptimization.component_multipliers) : defaultMultipliers();
  const adjustedWeights = Object.fromEntries(Object.entries(baseWeights).map(([key, value]) => [key, Math.max(0.05, value * (optimizationMultipliers[key] ?? 1))])) as Record<string, number>;
  const weightTotal = Object.values(adjustedWeights).reduce((sum, value) => sum + value, 0);
  const weights = Object.fromEntries(Object.entries(adjustedWeights).map(([key, value]) => [key, value / weightTotal])) as Record<string, number>;
  const appliedWeightShift = rawOptimization.active
    ? FORECAST_COMPONENT_MODELS.reduce((sum, model) => sum + Math.abs((weights[model] || 0) - (baselineWeights[model] || 0)), 0)
    : 0;
  const optimization: ForecastOptimization = { ...rawOptimization, applied_weight_shift: Number(appliedWeightShift.toFixed(4)) };

  const baseComponents = [
    forecastComponent("Momentum", momentumForecasts, weights.Momentum, dailyVolatility,
      [`动量模型分别使用 5/10/20/60 日累计收益生成各周期预测，不再由单日结果机械外推。`],
      ["Momentum forecasts are estimated separately from 5/10/20/60-day cumulative returns instead of mechanically compounding the 1-day result."]),
    forecastComponent("Trend", trendForecasts, weights.Trend, dailyVolatility,
      [`趋势模型：价格相对 20 日均线偏离 ${pct(latestPrice / ma20 - 1)}，20/50 日均线差 ${pct(ma20 / ma50 - 1)}。`],
      [`Trend model: price is ${pct(latestPrice / ma20 - 1)} from MA20 and MA20/MA50 spread is ${pct(ma20 / ma50 - 1)}.`]),
    forecastComponent("Mean Reversion", meanReversionForecasts, weights["Mean Reversion"], dailyVolatility,
      [Number.isFinite(rsiValue) ? `均值回归模型：RSI ${rsiValue.toFixed(1)}，价格相对均线偏离后加入修正。` : "均值回归模型：根据价格相对均线偏离做修正。"],
      [Number.isFinite(rsiValue) ? `Mean-reversion model: RSI is ${rsiValue.toFixed(1)} and price deviation from the average is adjusted.` : "Mean-reversion model adjusts for price deviation from the average."]),
    forecastComponent("Breakout", breakoutForecasts, weights.Breakout, dailyVolatility,
      [`突破确认模型：价格处于近 20 日区间 ${(rangePosition * 100).toFixed(0)}% 位置，成交量比例 ${volumeRatio.toFixed(2)}。`],
      [`Breakout model: price is at ${(rangePosition * 100).toFixed(0)}% of its 20-day range and volume ratio is ${volumeRatio.toFixed(2)}.`]),
    forecastComponent("Market Regime", marketForecasts, weights["Market Regime"], dailyVolatility,
      [`市场状态模型：当前为${marketRegime.label_zh}${benchmark5d !== null ? `，参考指数近 5 日 ${pct(benchmark5d)}` : ""}。`],
      [`Market-regime model: current regime is ${marketRegime.label_en}${benchmark5d !== null ? `; benchmark 5-day return is ${pct(benchmark5d)}` : ""}.`]),
    forecastComponent("Orivane K-Line Structure", klineForecasts, weights["Orivane K-Line Structure"], dailyVolatility,
      klineForecast.drivers_zh,
      klineForecast.drivers_en),
    forecastComponent("Historical Analogs", analogForecast.forecasts, weights["Historical Analogs"], dailyVolatility,
      analogForecast.drivers_zh,
      analogForecast.drivers_en),
  ];
  const officialKronos = history.context?.official_kronos;
  const contextualSignal = history.context?.contextual_signal;
  const overlayWeight = (officialKronos ? OFFICIAL_KRONOS_WEIGHT : 0) + (contextualSignal ? CONTEXTUAL_SIGNAL_WEIGHT : 0);
  const components = [
    ...baseComponents.map((component) => ({ ...component, weight: component.weight * (1 - overlayWeight) })),
    ...(officialKronos ? [forecastComponent("Kronos-mini (Official)", {
      d1: officialKronos.forecast_1d_return,
      d5: officialKronos.forecast_5d_return,
      d10: officialKronos.forecast_10d_return,
      d22: officialKronos.forecast_1m_return,
    }, OFFICIAL_KRONOS_WEIGHT, dailyVolatility,
    [`官方 Kronos-mini 基于 ${officialKronos.lookback} 根历史K线生成 ${officialKronos.prediction_length} 步路径，批次日期 ${officialKronos.data_as_of}。`],
    [`Official Kronos-mini used ${officialKronos.lookback} historical candles to generate a ${officialKronos.prediction_length}-step path dated ${officialKronos.data_as_of}.`])] : []),
    ...(contextualSignal ? [forecastComponent("Fundamental & Event Context", contextualSignal.forecasts, CONTEXTUAL_SIGNAL_WEIGHT, dailyVolatility,
      contextualSignal.drivers_zh,
      contextualSignal.drivers_en)] : []),
  ];

  const weighted = (field: keyof Pick<ForecastComponent, "forecast1d" | "forecast5d" | "forecast10d" | "forecast1m">) =>
    components.reduce((sum, component) => sum + component.weight * Number(component[field]), 0);
  const forecast1d = clamp(weighted("forecast1d"), -0.05, 0.05);
  const forecast5d = clamp(weighted("forecast5d"), -0.25, 0.25);
  const forecast10d = clamp(weighted("forecast10d"), -0.35, 0.35);
  const forecast1m = clamp(weighted("forecast1m"), -0.55, 0.55);
  const direction = forecast1d >= 0 ? "Up" : "Down";
  const referenceSign = Math.sign(forecast1d || forecast5d || forecast1m || 1);
  const agreementRatio = components.reduce((sum, component) => sum + (Math.sign(component.forecast1d) === referenceSign ? component.weight : 0), 0);
  const blendedSignal = forecast1d * 0.25 + forecast5d * 0.28 + forecast10d * 0.2 + forecast1m * 0.27;
  const strength = dailyVolatility > 0 ? Math.min(3, Math.abs(forecast1d) / dailyVolatility) : 0;
  const horizonStrength = dailyVolatility > 0 ? Math.min(3, Math.abs(blendedSignal) / (dailyVolatility * 5)) : strength;
  const quality = (horizonStrength >= 0.55 && agreementRatio >= 0.62) ? "High" : (horizonStrength >= 0.25 || agreementRatio >= 0.55) ? "Medium" : "Low";
  const signalDirection = blendedSignal >= 0 ? "Up" : "Down";
  const signal = quality === "Low" ? "Observe" : signalDirection;
  const volatilityPenalty = dailyVolatility > 0.04 ? 10 : dailyVolatility > 0.03 ? 6 : dailyVolatility > 0.022 ? 3 : 0;
  const klineAgreement = Math.sign(klineForecast.forecast1d || 1) === referenceSign ? 1 : -1;
  const klineConfidenceDelta = clamp(Math.abs(klineForecast.score) * 3 * klineAgreement, -3, 3);
  const confidenceScore = Math.round(clamp(
    38 + horizonStrength * 22 + agreementRatio * 18 + (quality === "High" ? 10 : quality === "Medium" ? 4 : -6) - volatilityPenalty + clamp(optimization.confidence_delta, -4, 4) + klineConfidenceDelta,
    0,
    100,
  ));
  const forecastDays = buildForecastPath(latestPrice, { d1: forecast1d, d5: forecast5d, d10: forecast10d, d22: forecast1m });
  const forecastVolatility1m = klineForecast.forecast_volatility_1m;
  const expectedRange1m: ForecastExpectedRange = {
    low: latestPrice * (1 + clamp(forecast1m - forecastVolatility1m * 0.95, -0.75, 0.75)),
    high: latestPrice * (1 + clamp(forecast1m + forecastVolatility1m * 0.95, -0.75, 0.95)),
    return_low: clamp(forecast1m - forecastVolatility1m * 0.95, -0.75, 0.75),
    return_high: clamp(forecast1m + forecastVolatility1m * 0.95, -0.75, 0.95),
  };
  const keyLevels = buildKeyLevels({ latestPrice, ma20, ma50, low20, high20, dailyVolatility, forecast1m });
  const action = buildForecastAction(forecast1m, confidenceScore, keyLevels);
  const scenarios = buildForecastScenarios(latestPrice, forecast1m, dailyVolatility, agreementRatio);
  const driversZh = [
    `组合模型权重：动量 ${(components.find((item) => item.model === "Momentum")!.weight * 100).toFixed(0)}%、趋势 ${(components.find((item) => item.model === "Trend")!.weight * 100).toFixed(0)}%、均值回归 ${(components.find((item) => item.model === "Mean Reversion")!.weight * 100).toFixed(0)}%、突破 ${(components.find((item) => item.model === "Breakout")!.weight * 100).toFixed(0)}%、市场状态 ${(components.find((item) => item.model === "Market Regime")!.weight * 100).toFixed(0)}%、K线结构 ${(components.find((item) => item.model === "Orivane K-Line Structure")!.weight * 100).toFixed(0)}%、历史相似状态 ${(components.find((item) => item.model === "Historical Analogs")!.weight * 100).toFixed(0)}%${officialKronos ? `、官方 Kronos ${(OFFICIAL_KRONOS_WEIGHT * 100).toFixed(0)}%` : ""}${contextualSignal ? `、基本面与事件 ${(CONTEXTUAL_SIGNAL_WEIGHT * 100).toFixed(0)}%` : ""}。`,
    `近 5/20 日累计收益分别为 ${pct(return5)}、${pct(return20)}，各预测周期独立估计。`,
    `${klineForecast.label_zh}，K线序列得分 ${klineForecast.score.toFixed(2)}，1个月预测波动区间约 ${pct(forecastVolatility1m)}。`,
    `价格相对 20 日均线偏离 ${pct(latestPrice / ma20 - 1)}，20/50 日均线差 ${pct(ma20 / ma50 - 1)}。`,
    Number.isFinite(macdHist) ? `MACD 柱值 ${macdHist >= 0 ? "偏正" : "偏负"}，反映短线动能。` : null,
    Number.isFinite(rsiValue) ? `RSI ${rsiValue.toFixed(1)}，${rsiValue > 70 ? "短线偏热" : rsiValue < 30 ? "短线偏冷" : "处于中性区间"}。` : null,
    `市场状态识别为${marketRegime.label_zh}，成交量为近 20 日均量的 ${volumeRatio.toFixed(2)} 倍。`,
    optimization.active ? `走步调权已启用：${optimization.notes_zh[0] || "根据历史验证微调子模型权重。"} 权重漂移 ${(appliedWeightShift * 100).toFixed(1)}%。` : `走步调权未启用：${optimization.notes_zh[0] || "样本不足或未通过留出验证。"}。`,
    keyLevels.invalidation_zh,
    `子模型方向一致度 ${(agreementRatio * 100).toFixed(0)}%，预测强度约为日波动的 ${strength.toFixed(2)} 倍。`,
  ].filter((item): item is string => Boolean(item));
  const driversEn = [
    `Ensemble weights: Momentum ${(components.find((item) => item.model === "Momentum")!.weight * 100).toFixed(0)}%, Trend ${(components.find((item) => item.model === "Trend")!.weight * 100).toFixed(0)}%, Mean Reversion ${(components.find((item) => item.model === "Mean Reversion")!.weight * 100).toFixed(0)}%, Breakout ${(components.find((item) => item.model === "Breakout")!.weight * 100).toFixed(0)}%, Market Regime ${(components.find((item) => item.model === "Market Regime")!.weight * 100).toFixed(0)}%, K-Line Structure ${(components.find((item) => item.model === "Orivane K-Line Structure")!.weight * 100).toFixed(0)}% and Historical Analogs ${(components.find((item) => item.model === "Historical Analogs")!.weight * 100).toFixed(0)}%${officialKronos ? `, official Kronos ${(OFFICIAL_KRONOS_WEIGHT * 100).toFixed(0)}%` : ""}${contextualSignal ? `, fundamentals and events ${(CONTEXTUAL_SIGNAL_WEIGHT * 100).toFixed(0)}%` : ""}.`,
    `5/20-day cumulative returns are ${pct(return5)} and ${pct(return20)}; each forecast horizon is estimated separately.`,
    `${klineForecast.label_en}; K-line sequence score is ${klineForecast.score.toFixed(2)} and 1-month forecast volatility is about ${pct(forecastVolatility1m)}.`,
    `Price is ${pct(latestPrice / ma20 - 1)} away from MA20 and MA20/MA50 spread is ${pct(ma20 / ma50 - 1)}.`,
    Number.isFinite(macdHist) ? `MACD histogram is ${macdHist >= 0 ? "positive" : "negative"}, indicating short-term momentum.` : null,
    Number.isFinite(rsiValue) ? `RSI is ${rsiValue.toFixed(1)}, ${rsiValue > 70 ? "short-term stretched" : rsiValue < 30 ? "short-term oversold" : "near neutral"}.` : null,
    `Market regime is ${marketRegime.label_en}; volume is ${volumeRatio.toFixed(2)}x the 20-day average.`,
    optimization.active ? `Walk-forward weight tuning is active: ${optimization.notes_en[0] || "component weights are tuned from validation history."} Weight shift is ${(appliedWeightShift * 100).toFixed(1)}%.` : `Walk-forward weight tuning is inactive: ${optimization.notes_en[0] || "insufficient samples or failed holdout validation."}.`,
    keyLevels.invalidation_en,
    `Component direction agreement is ${(agreementRatio * 100).toFixed(0)}%; forecast strength is about ${strength.toFixed(2)}x daily volatility.`,
  ].filter((item): item is string => Boolean(item));
  return {
    forecast1d,
    forecast5d,
    forecast10d,
    forecast1m,
    forecastDays,
    direction,
    signal,
    quality,
    strength,
    confidenceScore,
    agreementRatio,
    modelComponents: components,
    marketRegime,
    action,
    keyLevels,
    scenarios,
    klineForecast,
    forecastVolatility1m,
    expectedRange1m,
    optimization,
    drivers_zh: driversZh,
    drivers_en: driversEn,
  };
}

function ema(values: number[], span: number): number[] {
  const alpha = 2 / (span + 1);
  const result: number[] = [];
  values.forEach((value, index) => result.push(index === 0 ? value : alpha * value + (1 - alpha) * result[index - 1]));
  return result;
}

function rsi(values: number[], index: number, window = 14): number | null {
  if (index < window) return null;
  let gains = 0;
  let losses = 0;
  for (let cursor = index - window + 1; cursor <= index; cursor += 1) {
    const change = values[cursor] - values[cursor - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

function technicalRecords(timestamps: number[], quote: Record<string, Array<number | null>>, adjusted: Array<number | null>): HistoryRecord[] {
  const rows = timestamps.map((timestamp, index) => ({
    timestamp,
    open: quote.open?.[index],
    high: quote.high?.[index],
    low: quote.low?.[index],
    close: quote.close?.[index],
    volume: quote.volume?.[index],
    adjusted: adjusted?.[index],
  })).map((row) => {
    const adjustedPrice = Number(row.adjusted);
    const closePrice = Number(row.close);
    const hasAdjustedPrice = row.adjusted !== null && row.adjusted !== undefined;
    return {
      ...row,
      price: hasAdjustedPrice
        ? Number.isFinite(adjustedPrice) && adjustedPrice > 0 ? adjustedPrice : Number.NaN
        : closePrice,
    };
  }).filter((row) => Number.isFinite(row.price) && row.price > 0);
  const prices = rows.map((row) => row.price);
  const returns = prices.map((price, index) => index ? price / prices[index - 1] - 1 : 0);
  const ema12 = ema(prices, 12);
  const ema26 = ema(prices, 26);
  const macd = prices.map((_, index) => ema12[index] - ema26[index]);
  const signal = ema(macd, 9);
  return rows.map((row, index) => {
    const ma20 = movingAverage(prices, index, 20);
    const std20 = index + 1 < 20 ? null : standardDeviation(prices.slice(index - 19, index + 1));
    return {
      Date: new Date(row.timestamp * 1000).toISOString().slice(0, 10),
      Open: row.open ?? null,
      High: row.high ?? null,
      Low: row.low ?? null,
      Close: row.close ?? null,
      "Adj Close": row.adjusted ?? null,
      Volume: row.volume ?? null,
      Price: prices[index],
      Daily_Return: returns[index],
      Weekly_Return: index >= 5 ? prices[index] / prices[index - 5] - 1 : null,
      Cumulative_Return: prices[index] / prices[0] - 1,
      MA_5: movingAverage(prices, index, 5),
      MA_20: ma20,
      MA_50: movingAverage(prices, index, 50),
      RSI_14: rsi(prices, index),
      MACD: macd[index],
      MACD_Signal: signal[index],
      MACD_Hist: macd[index] - signal[index],
      BB_Middle: ma20,
      BB_Upper: ma20 !== null && std20 !== null ? ma20 + 2 * std20 : null,
      BB_Lower: ma20 !== null && std20 !== null ? ma20 - 2 * std20 : null,
      Rolling_Std_20: index + 1 < 20 ? null : standardDeviation(returns.slice(index - 19, index + 1)),
    };
  });
}

function yahooMarketSymbol(symbol: string): string {
  return symbol.toUpperCase().endsWith(".SH") ? `${symbol.slice(0, -3)}.SS` : symbol;
}

async function yahooHistory(symbol: string, start: string): Promise<Record<string, unknown>> {
  const startDate = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime())) throw new Error("Invalid start date.");
  const period1 = Math.floor(startDate.getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const period = start <= "1900-01-01" ? "range=max" : `period1=${period1}&period2=${period2}`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooMarketSymbol(symbol))}?${period}&interval=1d&events=history&includeAdjustedClose=true`;
  const response = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Yahoo Finance returned ${response.status}.`);
  const payload = await response.json() as {
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<Record<string, Array<number | null>>>; adjclose?: Array<{ adjclose?: Array<number | null> }> } }> };
  };
  const result = payload.chart?.result?.[0];
  if (!result?.timestamp?.length || !result.indicators?.quote?.[0]) throw new Error("No market history is available.");
  const records = technicalRecords(result.timestamp, result.indicators.quote[0], result.indicators.adjclose?.[0]?.adjclose || []);
  if (!records.length) throw new Error("No market history is available.");
  const prices = records.map((row) => Number(row.Price));
  const returns = records.map((row) => Number(row.Daily_Return)).slice(-20);
  const dataAsOf = String(records.at(-1)?.Date);
  return {
    symbol,
    data_source: "yahoo",
    source_description: "Yahoo Finance live market data",
    data_as_of: dataAsOf,
    snapshot: {
      latest_price: prices.at(-1),
      return_1d: prices.length > 1 ? prices.at(-1)! / prices.at(-2)! - 1 : null,
      return_5d: prices.length > 5 ? prices.at(-1)! / prices.at(-6)! - 1 : null,
      annualized_volatility_20d: returns.length > 1 ? standardDeviation(returns)! * Math.sqrt(252) : null,
    },
    records,
  };
}

function stooqSymbol(symbol: string): string | null {
  const upper = symbol.toUpperCase();
  if (/^[A-Z]{1,6}$/.test(upper)) return `${upper.toLowerCase()}.us`;
  if (/^[A-Z]{2,5}M$/.test(upper)) return `${upper.toLowerCase()}.us`;
  if (/^\d{4}\.HK$/.test(upper)) return `${upper.slice(0, 4)}.hk`;
  if (upper === "^IXIC") return "^ixic";
  if (upper === "^NDX") return "^ndx";
  if (upper === "^GSPC") return "^spx";
  return null;
}

function csvSplit(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else current += char;
  }
  result.push(current);
  return result;
}

async function stooqHistory(symbol: string, start: string): Promise<Record<string, unknown>> {
  const mapped = stooqSymbol(symbol);
  if (!mapped) throw new Error("No Stooq fallback symbol is available.");
  const startCode = start.replace(/-/g, "");
  const endCode = new Date(Date.now() + 86400000).toISOString().slice(0, 10).replace(/-/g, "");
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(mapped)}&d1=${startCode}&d2=${endCode}&i=d`;
  const response = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`Stooq returned ${response.status}.`);
  const text = await response.text();
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2 || /^No data/i.test(text)) throw new Error("No Stooq market history is available.");
  const rows = lines.slice(1).map(csvSplit).map(([date, open, high, low, close, volume]) => ({
    date,
    timestamp: Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
  })).filter((row) => row.date && Number.isFinite(row.timestamp) && Number.isFinite(row.close));
  if (!rows.length) throw new Error("No Stooq market history is available.");
  const records = technicalRecords(
    rows.map((row) => row.timestamp),
    {
      open: rows.map((row) => row.open),
      high: rows.map((row) => row.high),
      low: rows.map((row) => row.low),
      close: rows.map((row) => row.close),
      volume: rows.map((row) => row.volume),
    },
    rows.map((row) => row.close),
  );
  const prices = records.map((row) => Number(row.Price));
  const returns = records.map((row) => Number(row.Daily_Return)).slice(-20);
  return {
    symbol,
    data_source: "stooq",
    source_description: "Stooq cloud market data",
    data_as_of: String(records.at(-1)?.Date),
    snapshot: {
      latest_price: prices.at(-1),
      return_1d: prices.length > 1 ? prices.at(-1)! / prices.at(-2)! - 1 : null,
      return_5d: prices.length > 5 ? prices.at(-1)! / prices.at(-6)! - 1 : null,
      annualized_volatility_20d: returns.length > 1 ? standardDeviation(returns)! * Math.sqrt(252) : null,
    },
    records,
  };
}

async function eastmoneyKlineHistory(symbol: string, start: string): Promise<Record<string, unknown>> {
  const secid = await eastmoneyQuoteId(symbol);
  if (!secid) throw new Error("No Eastmoney quote id is available.");
  const fields = "fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101";
  const fetchRows = async (begin: string) => {
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&${fields}&fqt=2&beg=${begin}&end=20500101`;
    const response = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error(`Eastmoney kline returned ${response.status}.`);
    const payload = await response.json() as { data?: { klines?: string[] } };
    return (payload.data?.klines || []).map((line) => {
      const [date, open, close, high, low, volume] = line.split(",");
      return {
        date,
        timestamp: Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      };
    }).filter((row) => row.date && Number.isFinite(row.timestamp) && Number.isFinite(row.close) && row.close > 0);
  };
  const [adjustedRows, rawLatest] = await Promise.all([
    fetchRows(start.replace(/-/g, "")),
    fetch(`https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(secid)}&fields=f43,f59`, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(7000) })
      .then(async (response) => {
        if (!response.ok) return 0;
        const payload = await response.json() as { data?: { f43?: number; f59?: number } };
        const price = Number(payload.data?.f43);
        const decimals = Number(payload.data?.f59);
        return Number.isFinite(price) && Number.isFinite(decimals) ? price / 10 ** decimals : 0;
      })
      .catch(() => 0),
  ]);
  const adjustedLatest = adjustedRows.at(-1)?.close || 0;
  const scale = adjustedLatest > 0 && rawLatest > 0 ? rawLatest / adjustedLatest : 1;
  const rows = adjustedRows.map((row) => ({
    ...row,
    open: row.open * scale,
    high: row.high * scale,
    low: row.low * scale,
    close: row.close * scale,
  }));
  if (!rows.length) throw new Error("No Eastmoney market history is available.");
  const records = technicalRecords(
    rows.map((row) => row.timestamp),
    {
      open: rows.map((row) => row.open),
      high: rows.map((row) => row.high),
      low: rows.map((row) => row.low),
      close: rows.map((row) => row.close),
      volume: rows.map((row) => row.volume),
    },
    rows.map((row) => row.close),
  );
  const prices = records.map((row) => Number(row.Price));
  const returns = records.map((row) => Number(row.Daily_Return)).slice(-20);
  return {
    symbol,
    data_source: "eastmoney",
    source_description: "Eastmoney cloud market data",
    data_as_of: String(records.at(-1)?.Date),
    snapshot: {
      latest_price: prices.at(-1),
      return_1d: prices.length > 1 ? prices.at(-1)! / prices.at(-2)! - 1 : null,
      return_5d: prices.length > 5 ? prices.at(-1)! / prices.at(-6)! - 1 : null,
      annualized_volatility_20d: returns.length > 1 ? standardDeviation(returns)! * Math.sqrt(252) : null,
    },
    records,
  };
}

async function marketHistoryFallback(symbol: string, start: string): Promise<Record<string, unknown>> {
  try {
    return await yahooHistory(symbol, start);
  } catch (yahooCause) {
    try {
      return await eastmoneyKlineHistory(symbol, start);
    } catch (eastmoneyCause) {
      try {
        return await stooqHistory(symbol, start);
      } catch (stooqCause) {
        const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Yahoo: ${message(yahooCause)} Eastmoney: ${message(eastmoneyCause)} Stooq: ${message(stooqCause)}`);
      }
    }
  }
}

async function yahooOneYearReturn(asset: Asset): Promise<Asset & { return_1y: number; data_as_of: string }> {
  let points: Array<{ price: number; timestamp: number }> = [];
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooMarketSymbol(asset.symbol))}?range=1y&interval=1wk&events=history&includeAdjustedClose=true`;
    const response = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error(`Yahoo Finance returned ${response.status}.`);
    const payload = await response.json() as {
      chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }>; adjclose?: Array<{ adjclose?: Array<number | null> }> } }> };
    };
    const result = payload.chart?.result?.[0];
    const rawPrices = result?.indicators?.adjclose?.[0]?.adjclose || result?.indicators?.quote?.[0]?.close || [];
    points = rawPrices
      .map((price, index) => ({ price, timestamp: result?.timestamp?.[index] }))
      .filter((point): point is { price: number; timestamp: number } => typeof point.price === "number" && Number.isFinite(point.price) && typeof point.timestamp === "number");
  } catch {
    const start = new Date(Date.now() - 380 * 86400000).toISOString().slice(0, 10);
    const history = await marketHistoryFallback(asset.symbol, start) as { records: HistoryRecord[] };
    points = history.records.map((row) => ({ price: Number(row.Price), timestamp: Math.floor(new Date(`${row.Date}T00:00:00Z`).getTime() / 1000) })).filter((point) => Number.isFinite(point.price) && Number.isFinite(point.timestamp));
  }
  if (points.length < 2) throw new Error("Insufficient one-year history.");
  return {
    ...asset,
    return_1y: points.at(-1)!.price / points[0].price - 1,
    data_as_of: new Date(points.at(-1)!.timestamp * 1000).toISOString().slice(0, 10),
  };
}

async function marketGainers(): Promise<Array<Asset & { return_1y: number; data_as_of: string }>> {
  const settled = await settleWithConcurrency(GROWTH_SYMBOLS, 6, (symbol) => yahooOneYearReturn(inferAsset(symbol)));
  return settled
    .filter((item): item is PromiseFulfilledResult<Asset & { return_1y: number; data_as_of: string }> => item.status === "fulfilled")
    .map((item) => item.value)
    .filter((item) => item.return_1y > 0)
    .sort((left, right) => right.return_1y - left.return_1y)
    .slice(0, 24);
}

function latestRaw(series: Record<string, unknown>, type: string): number | null {
  const values = series[type];
  if (!Array.isArray(values) || !values.length) return null;
  const raw = (values.at(-1) as { reportedValue?: { raw?: unknown } })?.reportedValue?.raw;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

async function yahooFundamentals(symbol: string): Promise<Record<string, number | null>> {
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const period1 = period2 - 800 * 86400;
  const types = FUNDAMENTAL_TYPES.join(",");
  const endpoint = `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(yahooMarketSymbol(symbol))}?symbol=${encodeURIComponent(yahooMarketSymbol(symbol))}&type=${types}&merge=false&period1=${period1}&period2=${period2}`;
  const response = await fetch(endpoint, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Yahoo fundamentals returned ${response.status}.`);
  const payload = await response.json() as { timeseries?: { result?: Record<string, unknown>[] } };
  const rows = payload.timeseries?.result || [];
  const byType = new Map(rows.map((row) => [String((row.meta as { type?: string[] } | undefined)?.type?.[0] || ""), row]));
  const annualRevenue = byType.get("annualTotalRevenue");
  const annualRevenueValues = Array.isArray(annualRevenue?.annualTotalRevenue) ? annualRevenue.annualTotalRevenue as Array<{ reportedValue?: { raw?: number } }> : [];
  const annualIncome = byType.get("annualNetIncome");
  const annualIncomeValues = Array.isArray(annualIncome?.annualNetIncome) ? annualIncome.annualNetIncome as Array<{ reportedValue?: { raw?: number } }> : [];
  const growth = (values: Array<{ reportedValue?: { raw?: number } }>) => {
    const current = values.at(-1)?.reportedValue?.raw;
    const previous = values.at(-2)?.reportedValue?.raw;
    return typeof current === "number" && typeof previous === "number" && previous !== 0 ? current / previous - 1 : null;
  };
  const result: Record<string, number | null> = {};
  for (const type of FUNDAMENTAL_TYPES) result[type] = latestRaw(byType.get(type) || {}, type);
  result.revenueGrowth = growth(annualRevenueValues);
  result.netIncomeGrowth = growth(annualIncomeValues);
  return result;
}

async function yahooNews(symbol: string): Promise<Array<Record<string, unknown>>> {
  const endpoint = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(yahooMarketSymbol(symbol))}&quotesCount=1&newsCount=6`;
  const response = await fetch(endpoint, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(7000) });
  if (!response.ok) return [];
  const payload = await response.json() as { news?: Array<Record<string, unknown>> };
  return (payload.news || []).map((item) => ({
    title: item.title || "", publisher: item.publisher || "", link: item.link || "",
    published_at: typeof item.providerPublishTime === "number" ? new Date(item.providerPublishTime * 1000).toISOString() : null,
    thumbnail: ((item.thumbnail as { resolutions?: Array<{ url?: string }> } | undefined)?.resolutions || [])[0]?.url || null,
  }));
}

async function eastmoneySearchNews(asset: Asset): Promise<Array<Record<string, unknown>>> {
  const terms = [...new Set([
    asset.name_zh,
    hasChinese(asset.name) ? asset.name : null,
    asset.symbol,
  ].filter((item): item is string => Boolean(item)))].slice(0, 2);
  const rows: Array<Record<string, unknown>> = [];
  for (const term of terms) {
    const param = {
      uid: "",
      keyword: term,
      type: ["cmsArticleWebOld"],
      client: "web",
      clientType: "web",
      clientVersion: "curr",
      param: {
        cmsArticleWebOld: {
          searchScope: "default",
          sort: "default",
          pageIndex: 1,
          pageSize: 8,
          preTag: "",
          postTag: "",
        },
      },
    };
    const endpoint = `https://search-api-web.eastmoney.com/search/jsonp?cb=orivane&param=${encodeURIComponent(JSON.stringify(param))}`;
    const response = await fetch(endpoint, {
      headers: { ...YAHOO_HEADERS, referer: "https://so.eastmoney.com/" },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) continue;
    const payload = jsonpPayload(await response.text()) as { result?: { cmsArticleWebOld?: Array<Record<string, unknown>> } };
    rows.push(...(payload.result?.cmsArticleWebOld || []));
  }
  return [...new Map(rows.map((item) => [String(item.code || item.url || item.title), item])).values()]
    .map((item) => ({
      title: stripHtml(item.title),
      publisher: String(item.mediaName || "东方财富"),
      link: String(item.url || "").replace(/^http:/, "https:"),
      published_at: typeof item.date === "string" ? new Date(`${item.date.replace(" ", "T")}+08:00`).toISOString() : null,
      thumbnail: typeof item.image === "string" && item.image ? item.image.replace(/^http:/, "https:") : null,
      region: "cn",
    }))
    .filter((item) => item.title && item.link)
    .slice(0, 6);
}

async function eastmoneyFastNews(): Promise<Array<Record<string, unknown>>> {
  try {
    const endpoint = `https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&pageSize=6&sortEnd=&req_trace=${crypto.randomUUID()}`;
    const response = await fetch(endpoint, { headers: { ...YAHOO_HEADERS, referer: "https://kuaixun.eastmoney.com/" }, signal: AbortSignal.timeout(7000) });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: { fastNewsList?: Array<Record<string, unknown>> } };
    return (payload.data?.fastNewsList || []).map((item) => ({
      title: stripHtml(item.title),
      publisher: "东方财富快讯",
      link: item.code ? `https://kuaixun.eastmoney.com/a/${String(item.code)}.html` : "https://kuaixun.eastmoney.com/",
      published_at: typeof item.showTime === "string" ? new Date(`${item.showTime.replace(" ", "T")}+08:00`).toISOString() : null,
      thumbnail: null,
      region: "cn",
    })).filter((item) => item.title).slice(0, 6);
  } catch {
    return [];
  }
}

async function domesticNews(asset: Asset): Promise<Array<Record<string, unknown>>> {
  const related = await eastmoneySearchNews(asset).catch(() => []);
  return related.length ? related : eastmoneyFastNews();
}

async function yahooEarningsDate(symbol: string): Promise<string | null> {
  try {
    const endpoint = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooMarketSymbol(symbol))}?modules=calendarEvents`;
    const response = await fetch(endpoint, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const payload = await response.json() as {
      quoteSummary?: { result?: Array<{ calendarEvents?: { earnings?: { earningsDate?: Array<{ raw?: number; fmt?: string }> } } }> };
    };
    const item = payload.quoteSummary?.result?.[0]?.calendarEvents?.earnings?.earningsDate?.[0];
    if (typeof item?.raw === "number") return new Date(item.raw * 1000).toISOString().slice(0, 10);
    return item?.fmt || null;
  } catch {
    return null;
  }
}

function parseNasdaqDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const [month, day, year] = value.split("/").map(Number);
  if (!month || !day || !year) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

async function nasdaqEarningsEstimateDate(symbol: string): Promise<string | null> {
  if (!/^[A-Z]{1,5}$/.test(symbol)) return null;
  try {
    const response = await fetch(`https://api.nasdaq.com/api/company/${encodeURIComponent(symbol)}/earnings-surprise`, {
      headers: { ...YAHOO_HEADERS, accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: { earningsSurpriseTable?: { rows?: Array<{ dateReported?: string }> } } };
    const latest = parseNasdaqDate(payload.data?.earningsSurpriseTable?.rows?.[0]?.dateReported);
    if (!latest) return null;
    const date = new Date(`${latest}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 91);
    return date.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

async function nextEarnings(symbol: string): Promise<{ date: string | null; source: string | null }> {
  const yahoo = await yahooEarningsDate(symbol);
  if (yahoo) return { date: yahoo, source: "yahoo" };
  const estimated = await nasdaqEarningsEstimateDate(symbol);
  return { date: estimated, source: estimated ? "nasdaq_estimate" : null };
}

function headlineSentiment(news: Array<Record<string, unknown>>): number {
  const positive = /beat|beats|growth|upgrade|record|surge|profit|approval|buyback|上调|增长|创新高|获批|回购|超预期|盈利/i;
  const negative = /miss|cuts|downgrade|probe|lawsuit|decline|warning|loss|recall|下调|调查|诉讼|下滑|预警|亏损|召回/i;
  const scores = news.map((item) => {
    const title = String(item.title || "");
    return (positive.test(title) ? 1 : 0) - (negative.test(title) ? 1 : 0);
  });
  return scores.length ? clamp(mean(scores) || 0, -1, 1) : 0;
}

async function contextualForecastSignal(asset: Asset, dailyVolatility: number): Promise<ContextualForecastSignal | null> {
  if (asset.asset_type !== "stock") return null;
  const [fundamentals, news, earnings] = await Promise.all([
    cachedValue(`forecast/fundamentals-v1/${asset.symbol}`, 12 * 3600, () => yahooFundamentals(asset.symbol)).catch(() => ({})),
    cachedValue(`forecast/news-v1/${asset.symbol}`, 3 * 3600, () => yahooNews(asset.symbol)).catch(() => []),
    cachedValue(`forecast/earnings-v1/${asset.symbol}`, 12 * 3600, () => nextEarnings(asset.symbol)).catch(() => ({ date: null, source: null })),
  ]) as [Record<string, number | null>, Array<Record<string, unknown>>, { date: string | null; source: string | null }];
  const revenueGrowth = toNumber(fundamentals.revenueGrowth);
  const incomeGrowth = toNumber(fundamentals.netIncomeGrowth);
  const pe = toNumber(fundamentals.trailingPeRatio);
  const growthScore = mean([
    revenueGrowth === null ? 0 : clamp(revenueGrowth / 0.3, -1, 1),
    incomeGrowth === null ? 0 : clamp(incomeGrowth / 0.4, -1, 1),
  ]) || 0;
  const valuationScore = pe === null ? 0 : pe < 18 ? 0.35 : pe > 70 ? -0.35 : 0;
  const newsScore = headlineSentiment(news);
  const earningsDate = earnings.date ? new Date(`${earnings.date}T00:00:00Z`).getTime() : NaN;
  const earningsDays = Number.isFinite(earningsDate) ? Math.ceil((earningsDate - Date.now()) / 86400000) : null;
  const earningsRisk = earningsDays !== null && earningsDays >= 0 && earningsDays <= 7;
  const fundamentalScore = clamp(growthScore * 0.78 + valuationScore * 0.22, -1, 1);
  const score = clamp((fundamentalScore * 0.62 + newsScore * 0.38) * (earningsRisk ? 0.6 : 1), -1, 1);
  const volatility = Math.max(0.006, dailyVolatility || 0.012);
  const forecasts: HorizonForecasts = {
    d1: score * volatility * 0.18,
    d5: score * volatility * Math.sqrt(5) * 0.34,
    d10: score * volatility * Math.sqrt(10) * 0.42,
    d22: score * volatility * Math.sqrt(22) * 0.52,
  };
  const inputs = [
    revenueGrowth !== null ? "revenue_growth" : "",
    incomeGrowth !== null ? "income_growth" : "",
    pe !== null ? "valuation" : "",
    news.length ? "news_headlines" : "",
    earnings.date ? "earnings_calendar" : "",
  ].filter(Boolean);
  return {
    score,
    news_score: newsScore,
    fundamental_score: fundamentalScore,
    earnings_risk: earningsRisk,
    earnings_date: earnings.date,
    earnings_days: earningsDays,
    forecasts,
    inputs,
    drivers_zh: [
      `基本面与事件修正得分 ${score.toFixed(2)}，其中基本面 ${fundamentalScore.toFixed(2)}、新闻标题 ${newsScore.toFixed(2)}。`,
      earningsRisk ? `未来 7 天内临近财报，事件信号自动降权。` : `当前未识别到未来 7 天财报风险。`,
    ],
    drivers_en: [
      `Fundamental and event overlay is ${score.toFixed(2)}: fundamentals ${fundamentalScore.toFixed(2)}, headline sentiment ${newsScore.toFixed(2)}.`,
      earningsRisk ? "An earnings event is due within seven days, so the overlay is automatically reduced." : "No earnings event was identified within the next seven days.",
    ],
  };
}

async function companyResearch(symbol: string, newsRegion: NewsRegion): Promise<Record<string, unknown>> {
  const asset = await resolveAsset(symbol);
  const start = new Date(Date.now() - 380 * 86400000).toISOString().slice(0, 10);
  const [historyResult, fundamentalsResult, newsResult, earningsResult] = await Promise.allSettled([
    cachedPublicHistory(asset.symbol, start, asset.data_source, asset.asset_type),
    asset.asset_type === "stock" ? yahooFundamentals(asset.symbol) : Promise.resolve({}),
    newsRegion === "cn" ? domesticNews(asset) : yahooNews(asset.symbol),
    asset.asset_type === "stock" ? nextEarnings(asset.symbol) : Promise.resolve({ date: null, source: null }),
  ]);
  const history = historyResult.status === "fulfilled" ? historyResult.value as { data_as_of: string; snapshot: Record<string, unknown>; records: HistoryRecord[] } : null;
  const records = history?.records || [];
  const prices = records.map((row) => Number(row.Price)).filter(Number.isFinite);
  const market = {
    ...history?.snapshot,
    return_1y: prices.length > 1 ? prices.at(-1)! / prices[0] - 1 : null,
    high_52w: prices.length ? Math.max(...prices) : null,
    low_52w: prices.length ? Math.min(...prices) : null,
  };
  const fundamentals = fundamentalsResult.status === "fulfilled" ? fundamentalsResult.value as Record<string, number | null> : {};
  return {
    asset,
    sector: SECTORS[asset.symbol] || (asset.asset_type === "stock" ? "Other" : "Diversified"),
    data_as_of: history?.data_as_of || null,
    market,
    fundamentals,
    ...companyNarrative(asset, SECTORS[asset.symbol] || (asset.asset_type === "stock" ? "Other" : "Diversified"), market, fundamentals),
    next_earnings_date: earningsResult.status === "fulfilled" ? earningsResult.value?.date : null,
    next_earnings_date_source: earningsResult.status === "fulfilled" ? earningsResult.value?.source : null,
    news_region: newsRegion,
    news: newsResult.status === "fulfilled" ? newsResult.value : [],
  };
}

function sectorZh(value: string): string {
  return ({
    Technology: "科技", Consumer: "消费", Communication: "通信", Financial: "金融",
    Healthcare: "医疗健康", Industrials: "工业", Diversified: "多元资产", Other: "其他",
  } as Record<string, string>)[value] || value;
}

function companyNarrative(asset: Asset, sector: string, market: Record<string, unknown>, fundamentals: Record<string, number | null>): Record<string, unknown> {
  const name = asset.name_zh || asset.name;
  const return1y = market.return_1y;
  const volatility = market.annualized_volatility_20d;
  const pe = fundamentals.trailingPeRatio;
  const revenueGrowth = fundamentals.revenueGrowth;
  const strengthsZh: string[] = [];
  const strengthsEn: string[] = [];
  const risksZh: string[] = [];
  const risksEn: string[] = [];
  if (typeof return1y === "number" && return1y > 0.2) {
    strengthsZh.push(`近一年上涨 ${pct(return1y)}，价格趋势较强。`);
    strengthsEn.push(`The asset is up ${pct(return1y)} over one year, showing strong price momentum.`);
  }
  if (typeof revenueGrowth === "number" && revenueGrowth > 0.08) {
    strengthsZh.push(`营收增长 ${pct(revenueGrowth)}，基本面仍有扩张迹象。`);
    strengthsEn.push(`Revenue grew ${pct(revenueGrowth)}, pointing to continued fundamental expansion.`);
  }
  if (typeof pe === "number" && pe > 0 && pe < 28) {
    strengthsZh.push(`市盈率约 ${pe.toFixed(1)}，估值压力相对可控。`);
    strengthsEn.push(`P/E is about ${pe.toFixed(1)}, keeping valuation pressure relatively contained.`);
  }
  if (typeof volatility === "number" && volatility > 0.35) {
    risksZh.push(`近 20 日年化波动率 ${pct(volatility)}，短线波动偏高。`);
    risksEn.push(`20-day annualized volatility is ${pct(volatility)}, so short-term swings are elevated.`);
  }
  if (typeof pe === "number" && pe > 60) {
    risksZh.push(`市盈率约 ${pe.toFixed(1)}，需要关注估值回落风险。`);
    risksEn.push(`P/E is about ${pe.toFixed(1)}, so valuation compression risk should be watched.`);
  }
  if (typeof return1y === "number" && return1y < 0) {
    risksZh.push(`近一年收益为 ${pct(return1y)}，趋势尚未修复。`);
    risksEn.push(`One-year return is ${pct(return1y)}, so trend recovery is not confirmed yet.`);
  }
  const summaryZh = `${name} 属于${sectorZh(sector)}板块，近一年收益 ${pct(return1y)}，当前观察重点是趋势延续、估值水平与波动风险。`;
  const summaryEn = `${asset.name_en || asset.name} is in the ${sector} sector. Its one-year return is ${pct(return1y)}; the key watch items are trend durability, valuation and volatility risk.`;
  return {
    summary_zh: summaryZh,
    summary_en: summaryEn,
    strengths_zh: strengthsZh.length ? strengthsZh : ["当前可用数据有限，建议结合价格趋势继续观察。"],
    strengths_en: strengthsEn.length ? strengthsEn : ["Available data is limited; continue monitoring price trend confirmation."],
    risks_zh: risksZh.length ? risksZh : ["未发现突出的单项风险，但仍需关注市场整体波动。"],
    risks_en: risksEn.length ? risksEn : ["No single major risk stands out, but broader market volatility still matters."],
  };
}

async function screenerRow(symbol: string): Promise<Record<string, unknown>> {
  const asset = inferAsset(symbol);
  const start = new Date(Date.now() - 380 * 86400000).toISOString().slice(0, 10);
  const history = await marketHistoryFallback(symbol, start) as { data_as_of?: string; snapshot: Record<string, number | null>; records: HistoryRecord[] };
  const prices = history.records.map((row) => Number(row.Price)).filter(Number.isFinite);
  if (prices.length < 2) throw new Error("Insufficient screener history.");
  const latest = prices.at(-1)!;
  const return1y = latest / prices[0] - 1;
  const lookback3m = Math.max(0, prices.length - 66);
  const return3m = prices.length > lookback3m + 1 ? latest / prices[lookback3m] - 1 : null;
  const volatility = history.snapshot.annualized_volatility_20d ?? null;
  const trend = trendForecast(history);
  return {
    ...asset,
    return_1y: return1y,
    data_as_of: String(history.data_as_of || history.records.at(-1)?.Date || ""),
    sector: SECTORS[symbol] || (asset.asset_type === "stock" ? "Other" : "Diversified"),
    latest_price: history.snapshot.latest_price,
    return_1d: history.snapshot.return_1d,
    return_3m: return3m,
    volatility_20d: volatility,
    market_cap: null,
    pe_ratio: null,
    signal: trend.signal,
    confidence: Math.min(1, trend.strength),
    forecast_1d_return: trend.forecast1d,
    forecast_5d_return: trend.forecast5d,
    forecast_10d_return: trend.forecast10d,
    forecast_1m_return: trend.forecast1m,
    prediction_confidence_score: trend.confidenceScore,
    market_regime: trend.marketRegime,
    action: trend.action,
    recommendation_universe: "core_sample_pool",
    key_levels: trend.keyLevels,
    scenarios: trend.scenarios,
    forecast_drivers_zh: trend.drivers_zh,
    forecast_drivers_en: trend.drivers_en,
  };
}

async function screenerRows(): Promise<Array<Record<string, unknown>>> {
  const symbols = GROWTH_SYMBOLS.filter((symbol) => !symbol.startsWith("^")).slice(0, 32);
  const settled = await settleWithConcurrency(symbols, 6, screenerRow);
  return settled.filter((item): item is PromiseFulfilledResult<Record<string, unknown>> => item.status === "fulfilled").map((item) => item.value);
}

const SCREENER_ROW_FIELDS = [
  "symbol", "name", "name_en", "name_zh", "name_pinyin", "asset_type", "exchange", "currency", "data_source",
  "return_1y", "data_as_of", "sector", "latest_price", "return_1d", "return_3m", "volatility_20d",
  "market_cap", "pe_ratio", "signal", "confidence",
] as const;

function slimScreenerRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(SCREENER_ROW_FIELDS.flatMap((key) => row[key] === undefined ? [] : [[key, row[key]]]));
}

function recommendationScore(row: Record<string, unknown>): number {
  const return1y = typeof row.return_1y === "number" ? row.return_1y : 0;
  const return3m = typeof row.return_3m === "number" ? row.return_3m : 0;
  const confidence = typeof row.confidence === "number" ? row.confidence : 0;
  const prediction = typeof row.forecast_1d_return === "number" ? row.forecast_1d_return : 0;
  const volatility = typeof row.volatility_20d === "number" ? row.volatility_20d : 0;
  const actionable = Boolean((row.action as ForecastAction | undefined)?.actionable);
  const validatedForecast = actionable ? confidence * 0.12 + prediction * 6 : 0;
  return return1y * 0.5 + return3m * 0.3 + validatedForecast - volatility * 0.18;
}

function enrichRecommendation(row: Record<string, unknown>): Record<string, unknown> {
  const return1y = typeof row.return_1y === "number" ? row.return_1y : null;
  const return3m = typeof row.return_3m === "number" ? row.return_3m : null;
  const volatility = typeof row.volatility_20d === "number" ? row.volatility_20d : null;
  const pe = typeof row.pe_ratio === "number" ? row.pe_ratio : null;
  const signal = String(row.signal || "Observe");
  const forecast1d = typeof row.forecast_1d_return === "number" ? row.forecast_1d_return : null;
  const forecast1m = typeof row.forecast_1m_return === "number" ? row.forecast_1m_return : null;
  const predictionScoreValue = typeof row.prediction_confidence_score === "number" ? row.prediction_confidence_score : null;
  const action = row.action as ForecastAction | undefined;
  const validatedForecastBonus = action?.actionable
    ? (forecast1m || 0) * 180 + (predictionScoreValue ? (predictionScoreValue - 50) * 0.08 : 0)
    : 0;
  const score = Math.round(clamp(50 + recommendationScore(row) * 35 + validatedForecastBonus, 0, 100));
  const riskZh = volatility === null ? "风险待确认" : volatility > 0.45 ? "高波动" : volatility > 0.25 ? "中等波动" : "低波动";
  const riskEn = volatility === null ? "Risk pending" : volatility > 0.45 ? "High volatility" : volatility > 0.25 ? "Moderate volatility" : "Lower volatility";
  const styleZh = return1y !== null && return1y > 0.5
    ? "强趋势"
    : return3m !== null && return3m > 0.12
      ? "中期动量"
      : pe !== null && pe > 0 && pe < 30
        ? "估值观察"
        : volatility !== null && volatility > 0.45
          ? "高波动观察"
          : "持续跟踪";
  const styleEn = return1y !== null && return1y > 0.5
    ? "Strong trend"
    : return3m !== null && return3m > 0.12
      ? "Mid-term momentum"
      : pe !== null && pe > 0 && pe < 30
        ? "Value watch"
        : volatility !== null && volatility > 0.45
          ? "High-volatility watch"
          : "Tracking candidate";
  const horizonZh = action?.label_zh || (volatility !== null && volatility > 0.45 ? "短线波动较大，适合分批观察" : return3m !== null && Math.abs(return3m) > 0.12 ? "适合 1-3 个月趋势跟踪" : "适合中长期观察");
  const horizonEn = action?.label_en || (volatility !== null && volatility > 0.45 ? "Volatile in the short term; watch in stages" : return3m !== null && Math.abs(return3m) > 0.12 ? "Suited for 1-3 month trend tracking" : "Suited for medium-term monitoring");
  const tagsZh = [
    return1y !== null && return1y > 0.5 ? "强趋势" : null,
    return3m !== null && return3m > 0.12 ? "中期动量" : null,
    action?.actionable ? (signal === "Up" ? "模型看涨" : signal === "Down" ? "模型看跌" : "继续观察") : "方向观察",
    action?.actionable && predictionScoreValue !== null && predictionScoreValue >= 70 ? "高可信预测" : null,
    action?.actionable && forecast1m !== null && forecast1m > 0.035 ? "1个月预测偏强" : action?.actionable && forecast1m !== null && forecast1m < -0.035 ? "1个月预测偏弱" : null,
    pe !== null && pe > 0 && pe < 30 ? "估值可控" : null,
  ].filter(Boolean);
  const tagsEn = [
    return1y !== null && return1y > 0.5 ? "Strong trend" : null,
    return3m !== null && return3m > 0.12 ? "Mid-term momentum" : null,
    action?.actionable ? (signal === "Up" ? "Bullish model" : signal === "Down" ? "Bearish model" : "Watchlist") : "Directional watch",
    action?.actionable && predictionScoreValue !== null && predictionScoreValue >= 70 ? "High-confidence forecast" : null,
    action?.actionable && forecast1m !== null && forecast1m > 0.035 ? "Strong 1M forecast" : action?.actionable && forecast1m !== null && forecast1m < -0.035 ? "Weak 1M forecast" : null,
    pe !== null && pe > 0 && pe < 30 ? "Controlled valuation" : null,
  ].filter(Boolean);
  const reasonZh = action?.actionable && signal === "Up"
    ? `模型信号已通过验证门槛，下一交易日预测 ${pct(forecast1d)}，1 个月预测 ${pct(forecast1m)}。`
    : action?.actionable && signal === "Down"
      ? `模型转弱信号已通过验证门槛，下一交易日预测 ${pct(forecast1d)}，适合作为风险观察。`
      : return1y !== null && return1y > 0.5
        ? `近一年上涨 ${pct(return1y)}，历史趋势领先；预测尚未通过操作门槛，本次仅按趋势与风险入选。`
        : return3m !== null && return3m > 0.12
          ? `近 3 个月上涨 ${pct(return3m)}，中期动量较强；预测尚未通过操作门槛。`
          : `趋势和风险处于观察区间；预测尚未通过操作门槛。`;
  const reasonEn = action?.actionable && signal === "Up"
    ? `The model cleared the validation threshold, with a next-session forecast of ${pct(forecast1d)} and a 1-month forecast of ${pct(forecast1m)}.`
    : action?.actionable && signal === "Down"
      ? `The weakening signal cleared the validation threshold; the next-session forecast is ${pct(forecast1d)} and is best treated as a risk watch.`
      : return1y !== null && return1y > 0.5
        ? `Up ${pct(return1y)} over one year with leading historical momentum; the forecast has not cleared the action threshold, so this candidate is ranked on trend and risk only.`
        : return3m !== null && return3m > 0.12
          ? `Up ${pct(return3m)} over three months with strong mid-term momentum; the forecast has not cleared the action threshold.`
          : `Trend and risk remain in watch mode; the forecast has not cleared the action threshold.`;
  return {
    ...row,
    recommendation_score: score,
    recommendation_reason_zh: reasonZh,
    recommendation_reason_en: reasonEn,
    recommendation_risk_zh: riskZh,
    recommendation_risk_en: riskEn,
    recommendation_style_zh: styleZh,
    recommendation_style_en: styleEn,
    recommendation_horizon_zh: horizonZh,
    recommendation_horizon_en: horizonEn,
    recommendation_tags_zh: tagsZh,
    recommendation_tags_en: tagsEn,
  };
}

const RECOMMENDATION_ROW_FIELDS = [
  ...SCREENER_ROW_FIELDS,
  "forecast_1d_return", "forecast_1m_return", "prediction_confidence_score",
  "recommendation_score", "recommendation_reason_zh", "recommendation_reason_en",
  "recommendation_risk_zh", "recommendation_risk_en", "recommendation_style_zh", "recommendation_style_en",
  "recommendation_horizon_zh", "recommendation_horizon_en", "recommendation_tags_zh", "recommendation_tags_en",
] as const;

function slimRecommendationRow(row: Record<string, unknown>): Record<string, unknown> {
  const result = Object.fromEntries(RECOMMENDATION_ROW_FIELDS.flatMap((key) => row[key] === undefined ? [] : [[key, row[key]]]));
  const action = row.action as ForecastAction | undefined;
  if (action) {
    result.action = {
      actionable: action.actionable,
      label_zh: action.label_zh,
      label_en: action.label_en,
    };
  }
  return result;
}

async function recommendationGroup(id: keyof typeof RECOMMENDATION_SYMBOLS): Promise<Record<string, unknown>> {
  const titles = {
    a_shares: { title_zh: "A股研究候选", title_en: "A-share research candidates", summary_zh: "按趋势、风险和估值排序；只有通过验证门槛的预测才参与评分。", summary_en: "Ranked by trend, risk and valuation; forecasts affect scores only after clearing validation thresholds." },
    us_stocks: { title_zh: "美股研究候选", title_en: "US stock research candidates", summary_zh: "按动量、数据完整度和风险排序；未验证预测不参与推荐评分。", summary_en: "Ranked by momentum, data coverage and risk; unvalidated forecasts do not affect recommendation scores." },
    hk_stocks: { title_zh: "港股研究候选", title_en: "Hong Kong research candidates", summary_zh: "覆盖互联网、消费和金融资产；未验证预测仅展示为方向观察。", summary_en: "Covers internet, consumer and financial assets; unvalidated forecasts remain directional observations only." },
  } as const;
  const settled = await settleWithConcurrency(RECOMMENDATION_SYMBOLS[id], 2, screenerRow);
  const rows = settled
    .filter((item): item is PromiseFulfilledResult<Record<string, unknown>> => item.status === "fulfilled")
    .map((item) => item.value)
    .sort((left, right) => recommendationScore(right) - recommendationScore(left))
    .map(enrichRecommendation)
    .map(slimRecommendationRow)
    .slice(0, 8);
  return { id, ...titles[id], data_as_of: rows[0]?.data_as_of || null, rows };
}

async function recommendations(): Promise<Record<string, unknown>> {
  const groups = await Promise.all([
    recommendationGroup("a_shares"),
    recommendationGroup("us_stocks"),
    recommendationGroup("hk_stocks"),
  ]);
  return { data_as_of: groups.find((group) => group.data_as_of)?.data_as_of || null, groups };
}

function marketOverviewFromRows(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  const byDay = [...rows].filter((row) => typeof row.return_1d === "number").sort((a, b) => Number(b.return_1d) - Number(a.return_1d));
  const byConfidence = [...rows].filter((row) => typeof row.confidence === "number").sort((a, b) => Number(b.confidence) - Number(a.confidence));
  const byForecast = [...rows].filter((row) => typeof row.forecast_1m_return === "number").sort((a, b) => Number(b.forecast_1m_return) - Number(a.forecast_1m_return));
  const byRisk = [...rows].filter((row) => typeof row.volatility_20d === "number").sort((a, b) => Number(b.volatility_20d) - Number(a.volatility_20d));
  return {
    gainers: byDay.slice(0, 5),
    losers: byDay.slice(-5).reverse(),
    forecast_movers: byConfidence.slice(0, 5),
    forecast_bullish: byForecast.slice(0, 5),
    forecast_bearish: byForecast.slice(-5).reverse(),
    risk_watch: byRisk.slice(0, 5),
    data_as_of: rows[0]?.data_as_of || null,
  };
}

async function marketOverview(): Promise<Record<string, unknown>> {
  return marketOverviewFromRows(await screenerRows());
}

async function forecastScoreboard(): Promise<Record<string, unknown>> {
  const symbols = ["SPY", "QQQ", "NVDA"];
  const monitoredSymbols = ["SPY", "QQQ", "NVDA", "AAPL", "MSFT", "AMD", "TSM", "MU", "600519.SH", "300750.SZ", "002594.SZ", "0700.HK", "9988.HK", "3690.HK", "1211.HK"];
  const backtestRows: Array<Record<string, unknown>> = [];
  const liveRows: Array<Record<string, unknown>> = [];
  const perAsset: Array<Record<string, unknown>> = [];
  const dataDates: string[] = [];
  const settled = await Promise.allSettled(symbols.map(async (symbol) => {
    const asset = inferAsset(symbol);
    const start = new Date(Date.now() - 900 * 86400000).toISOString().slice(0, 10);
    const history = await cachedPublicHistory(asset.symbol, start, asset.data_source, asset.asset_type) as { data_as_of?: string; records: HistoryRecord[] };
    const [live, governance, kronos] = await Promise.all([
      cloudLedgerHistory(asset.symbol).catch(() => null),
      readModelGovernance(asset.symbol).catch(() => null),
      readOfficialKronos(asset.symbol).catch(() => null),
    ]);
    return { symbol, history, live, governance, kronos };
  }));
  settled.forEach((result) => {
    if (result.status !== "fulfilled") return;
    const assetBacktestRows = walkForwardPredictionRows(result.value.symbol, result.value.history);
    backtestRows.push(...assetBacktestRows);
    if (Array.isArray(result.value.live?.records)) liveRows.push(...result.value.live.records as Array<Record<string, unknown>>);
    if (result.value.history.data_as_of) dataDates.push(String(result.value.history.data_as_of));
    const assetBacktest = buildLedgerHistory(result.value.symbol, assetBacktestRows);
    const assetLive = result.value.live || emptyLedgerHistory(result.value.symbol, "Frozen live samples are accumulating.");
    perAsset.push({
      symbol: result.value.symbol,
      data_as_of: result.value.history.data_as_of || null,
      backtest: {
        statistics: assetBacktest.statistics,
        horizon_statistics: assetBacktest.horizon_statistics,
      },
      live: {
        statistics: assetLive.statistics,
        horizon_statistics: assetLive.horizon_statistics,
      },
      governance: result.value.governance,
      kronos: result.value.kronos ? {
        model_id: result.value.kronos.model_id,
        data_as_of: result.value.kronos.data_as_of,
        generated_at: result.value.kronos.generated_at,
      } : null,
    });
  });
  if (!backtestRows.length) throw new Error("Core forecast validation data is temporarily unavailable.");
  const backtest = buildLedgerHistory("CORE", backtestRows);
  const live = buildLedgerHistory("CORE", liveRows);
  const monitored = await settleWithConcurrency(monitoredSymbols, 5, async (symbol) => ({ symbol, records: await readCloudLedger(symbol) }));
  const recentLiveRecords = monitored.reduce<Array<Record<string, unknown>>>((records, item) => {
    if (item.status === "fulfilled") item.value.records.forEach((record) => records.push({ ...record, Symbol: String(record.Symbol || item.value.symbol) }));
    return records;
  }, []).sort((left, right) => String(right.As_Of_Date).localeCompare(String(left.As_Of_Date))).slice(0, 250);
  return {
    scope: "SPY, QQQ, NVDA core validation sample",
    symbols,
    data_as_of: dataDates.sort().at(-1) || null,
    generated_at: new Date().toISOString(),
    methodology: {
      frozen_live_predictions: true,
      walk_forward_backtest_separated: true,
      automatic_settlement: true,
      drift_monitoring: true,
      automatic_rollback: true,
      official_kronos_source: "NeoQuasar/Kronos-mini",
    },
    monitored_symbols: monitoredSymbols,
    recent_live_records: recentLiveRecords,
    per_asset: perAsset,
    backtest: {
      statistics: backtest.statistics,
      horizon_statistics: backtest.horizon_statistics,
    },
    live: {
      statistics: live.statistics,
      horizon_statistics: live.horizon_statistics,
    },
  };
}

const HOME_ROW_FIELDS = [
  "symbol", "name", "name_en", "name_zh", "name_pinyin", "asset_type", "exchange", "currency", "data_source",
  "return_1y", "data_as_of", "sector", "latest_price", "return_1d", "return_3m", "volatility_20d", "signal",
  "confidence", "forecast_1d_return", "forecast_5d_return", "forecast_10d_return", "forecast_1m_return", "prediction_confidence_score",
] as const;

function slimHomeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(HOME_ROW_FIELDS.flatMap((key) => row[key] === undefined ? [] : [[key, row[key]]]));
}

async function homeData(): Promise<Record<string, unknown>> {
  const rows = await screenerRows();
  if (!rows.length) throw new Error("Market discovery data is temporarily unavailable.");
  const gainers = rows
    .filter((row) => typeof row.return_1y === "number" && Number(row.return_1y) > 0)
    .sort((left, right) => Number(right.return_1y) - Number(left.return_1y))
    .slice(0, 24)
    .map(slimHomeRow);
  const overview = marketOverviewFromRows(rows) as Record<string, unknown>;
  const slimOverview = Object.fromEntries(Object.entries(overview).map(([key, value]) => [key, Array.isArray(value) ? value.map(slimHomeRow) : value]));
  return { gainers, overview: slimOverview };
}

function emptyUserState(): Record<string, unknown> {
  return {
    watchlists: [{ id: "default", name: "My Watchlist", symbols: [] }],
    alerts: [],
    alert_history: [],
    portfolios: [],
    savedScreeners: [],
    research_reviews: {},
    ai_chats: {},
    notification_preferences: {
      email_enabled: true,
      browser_enabled: false,
      daily_digest: true,
      quiet_hours_enabled: true,
      quiet_start: "22:00",
      quiet_end: "08:00",
      timezone: "Asia/Shanghai",
      min_interval_minutes: 60,
    },
    state_revision: 0,
    updated_at: null,
  };
}

function authStore(context?: Context) {
  return context?.deploy?.context === "production"
    ? getStore({ name: "orivane-user-state", consistency: "strong" })
    : getDeployStore({ name: "orivane-user-state" });
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function authUserKey(email: string): string {
  return `auth/users/${encodeURIComponent(email)}.json`;
}

function authSessionKey(token: string): string {
  return `auth/sessions/${token}.json`;
}

function authStateKey(state: string): string {
  return `auth/google-state/${state}.json`;
}

function authAppleStateKey(state: string): string {
  return `auth/apple-state/${state}.json`;
}

function publicAuthUser(record: AuthRecord): AuthUser {
  return {
    id: record.id,
    email: record.email,
    name: record.name,
    pictureUrl: record.pictureUrl || null,
    confirmedAt: record.confirmedAt,
  };
}

function randomSalt(): string {
  return crypto.randomUUID();
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function legacyPasswordHash(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  return bufferToBase64(await crypto.subtle.digest("SHA-256", data));
}

const PASSWORD_ITERATIONS = 210000;

async function passwordHash(password: string, salt: string, iterations = PASSWORD_ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: new TextEncoder().encode(salt),
    iterations,
  }, key, 256);
  return `pbkdf2_sha256$${iterations}$${salt}$${bufferToBase64(derived)}`;
}

async function verifyPassword(password: string, record: AuthRecord): Promise<{ valid: boolean; needs_upgrade: boolean }> {
  if (record.password_hash.startsWith("pbkdf2_sha256$")) {
    const [, rawIterations, storedSalt, storedHash] = record.password_hash.split("$");
    const iterations = Number(rawIterations);
    if (!Number.isFinite(iterations) || !storedSalt || !storedHash) return { valid: false, needs_upgrade: false };
    const candidate = await passwordHash(password, storedSalt, iterations);
    return { valid: candidate === record.password_hash, needs_upgrade: iterations < PASSWORD_ITERATIONS };
  }
  const valid = record.password_hash === await legacyPasswordHash(password, record.salt);
  return { valid, needs_upgrade: valid };
}

async function createAuthSession(user: AuthRecord, context?: Context): Promise<{ token: string; user: AuthUser }> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
  await authStore(context).setJSON(authSessionKey(token), {
    token,
    user_id: user.id,
    email: user.email,
    expires_at: expiresAt,
  } satisfies AuthSession);
  return { token, user: publicAuthUser(user) };
}

function authCookie(token: string, maxAge = 30 * 86400): string {
  return `orivane_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function authToken(request: Request): string | null {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || cookieValue(request, "orivane_session");
}

function authSessionResponse(session: { token: string; user: AuthUser }): Response {
  return new Response(JSON.stringify({ data: { user: session.user } }), {
    status: 200,
    headers: { ...PRIVATE_HEADERS, "set-cookie": authCookie(session.token) },
  });
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
  const found = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

function originOf(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function safeNextPath(value: unknown): string {
  const raw = String(value || "/").trim() || "/";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("//")) return "/";
  return raw.startsWith("/") ? raw.slice(0, 300) : "/";
}

async function userFromSessionToken(request: Request, context?: Context): Promise<AuthUser | null> {
  const token = authToken(request);
  if (!token) return null;
  const store = authStore(context);
  const session = await store.get(authSessionKey(token), { type: "json" }) as AuthSession | null;
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await store.delete(authSessionKey(token)).catch(() => undefined);
    return null;
  }
  const record = await store.get(authUserKey(session.email), { type: "json" }) as AuthRecord | null;
  return record ? publicAuthUser(record) : null;
}

async function currentUser(request: Request, context?: Context): Promise<AuthUser | null> {
  const sessionUser = await userFromSessionToken(request, context).catch(() => null);
  if (sessionUser) return sessionUser;
  const legacyUser = await getUser().catch(() => null);
  return legacyUser?.id ? { id: legacyUser.id, email: legacyUser.email || "", name: legacyUser.name, pictureUrl: legacyUser.pictureUrl || null, confirmedAt: legacyUser.confirmedAt } : null;
}

async function authResponse(request: Request, context: Context): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/(?:api|\.netlify\/functions\/api)/, "") || "/";
  if (request.method === "GET" && path === "/auth/config") {
    return privateJson({ data: {
      googleEnabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      appleEnabled: Boolean(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET),
      signupEnabled: true,
    } });
  }
  if (request.method === "GET" && path === "/auth/me") {
    return privateJson({ data: await currentUser(request, context) });
  }
  if (request.method === "GET" && path === "/auth/google/start") {
    const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
    const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
    if (!clientId || !clientSecret) return privateJson({ error: { code: "google_not_configured", message: "Google 登录尚未配置。" } }, 503);
    const state = crypto.randomUUID();
    const next = safeNextPath(url.searchParams.get("next"));
    await authStore(context).setJSON(authStateKey(state), { next, expires_at: new Date(Date.now() + 10 * 60000).toISOString() });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${originOf(request)}/api/auth/google/callback`,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    });
    return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
  }
  if (request.method === "GET" && path === "/auth/google/callback") {
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const store = authStore(context);
    const savedState = state ? await store.get(authStateKey(state), { type: "json" }) as { next?: string; expires_at?: string } | null : null;
    if (state && savedState) await store.delete(authStateKey(state)).catch(() => undefined);
    const next = safeNextPath(savedState?.next);
    if (!code || !savedState || !savedState.expires_at || new Date(savedState.expires_at).getTime() < Date.now()) {
      return Response.redirect(`${originOf(request)}${next}?auth=failed`, 302);
    }
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: (process.env.GOOGLE_CLIENT_ID || "").trim(),
        client_secret: (process.env.GOOGLE_CLIENT_SECRET || "").trim(),
        redirect_uri: `${originOf(request)}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    const tokenPayload = await tokenResponse.json().catch(() => ({})) as { access_token?: string; error_description?: string };
    if (!tokenResponse.ok || !tokenPayload.access_token) {
      console.error("Google token exchange failed", tokenPayload.error_description || tokenResponse.status);
      return Response.redirect(`${originOf(request)}${next}?auth=failed`, 302);
    }
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokenPayload.access_token}` },
    });
    const profile = await profileResponse.json().catch(() => ({})) as { sub?: string; email?: string; name?: string; picture?: string; email_verified?: boolean };
    const email = normalizeEmail(profile.email);
    if (!profileResponse.ok || !profile.sub || !email) return Response.redirect(`${originOf(request)}${next}?auth=failed`, 302);
    const key = authUserKey(email);
    const existing = await store.get(key, { type: "json" }) as AuthRecord | null;
    const now = new Date().toISOString();
    const record: AuthRecord = {
      ...(existing || {
        id: crypto.randomUUID(),
        email,
        salt: "",
        password_hash: "",
        created_at: now,
      }),
      name: profile.name || existing?.name || email.split("@")[0],
      pictureUrl: profile.picture || existing?.pictureUrl || null,
      confirmedAt: profile.email_verified === false ? existing?.confirmedAt || now : now,
      provider: existing?.provider || "google",
      google_sub: profile.sub,
      updated_at: now,
    };
    await store.setJSON(key, record);
    const session = await createAuthSession(record, context);
    const cleanNext = next.includes("?") ? `${next}&auth=google` : `${next}?auth=google`;
    return new Response(null, {
      status: 302,
      headers: { location: `${originOf(request)}${cleanNext}`, "set-cookie": authCookie(session.token) },
    });
  }
  if (request.method === "GET" && path === "/auth/apple/start") {
    const clientId = (process.env.APPLE_CLIENT_ID || "").trim();
    const clientSecret = (process.env.APPLE_CLIENT_SECRET || "").trim();
    if (!clientId || !clientSecret) return privateJson({ error: { code: "apple_not_configured", message: "Apple 登录尚未配置。" } }, 503);
    const state = crypto.randomUUID();
    const next = safeNextPath(url.searchParams.get("next"));
    await authStore(context).setJSON(authAppleStateKey(state), { next, expires_at: new Date(Date.now() + 10 * 60000).toISOString() });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${originOf(request)}/api/auth/apple/callback`,
      response_type: "code",
      response_mode: "form_post",
      scope: "name email",
      state,
    });
    return Response.redirect(`https://appleid.apple.com/auth/authorize?${params.toString()}`, 302);
  }
  if (request.method === "POST" && path === "/auth/apple/callback") {
    const body = await parseBody(request);
    const code = String(body.code || "");
    const state = String(body.state || "");
    const store = authStore(context);
    const savedState = state ? await store.get(authAppleStateKey(state), { type: "json" }) as { next?: string; expires_at?: string } | null : null;
    if (state && savedState) await store.delete(authAppleStateKey(state)).catch(() => undefined);
    const next = safeNextPath(savedState?.next);
    if (!code || !savedState?.expires_at || new Date(savedState.expires_at).getTime() < Date.now()) return Response.redirect(`${originOf(request)}${next}?auth=failed`, 302);
    const clientId = (process.env.APPLE_CLIENT_ID || "").trim();
    const tokenResponse = await fetch("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: (process.env.APPLE_CLIENT_SECRET || "").trim(),
        code,
        grant_type: "authorization_code",
        redirect_uri: `${originOf(request)}/api/auth/apple/callback`,
      }),
    });
    const tokenPayload = await tokenResponse.json().catch(() => ({})) as { id_token?: string; error_description?: string };
    if (!tokenResponse.ok || !tokenPayload.id_token) return Response.redirect(`${originOf(request)}${next}?auth=failed`, 302);
    let claims: { sub?: string; email?: string; iss?: string; aud?: string | string[]; exp?: number } = {};
    try { claims = JSON.parse(atob(tokenPayload.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(tokenPayload.id_token.split(".")[1].length / 4) * 4, "="))); } catch { return Response.redirect(`${originOf(request)}${next}?auth=failed`, 302); }
    const validAudience = claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.includes(clientId));
    if (!claims.sub || !claims.email || claims.iss !== "https://appleid.apple.com" || !validAudience || (claims.exp && claims.exp < Math.floor(Date.now() / 1000))) return Response.redirect(`${originOf(request)}${next}?auth=failed`, 302);
    const email = normalizeEmail(claims.email);
    const key = authUserKey(email);
    const existing = await store.get(key, { type: "json" }) as AuthRecord | null;
    const now = new Date().toISOString();
    const userPayload = typeof body.user === "string" ? (() => { try { return JSON.parse(body.user) as { name?: { firstName?: string; lastName?: string } }; } catch { return null; } })() : null;
    const appleName = [userPayload?.name?.firstName, userPayload?.name?.lastName].filter(Boolean).join(" ");
    const record: AuthRecord = {
      ...(existing || { id: crypto.randomUUID(), email, salt: "", password_hash: "", created_at: now }),
      name: appleName || existing?.name || email.split("@")[0],
      pictureUrl: existing?.pictureUrl || null,
      confirmedAt: now,
      provider: "apple",
      apple_sub: claims.sub,
      updated_at: now,
    };
    await store.setJSON(key, record);
    const session = await createAuthSession(record, context);
    const cleanNext = next.includes("?") ? `${next}&auth=apple` : `${next}?auth=apple`;
    return new Response(null, { status: 302, headers: { location: `${originOf(request)}${cleanNext}`, "set-cookie": authCookie(session.token) } });
  }
  if (request.method === "DELETE" && path === "/auth/account") {
    const user = await currentUser(request, context);
    if (!user?.id || !user.email) return privateJson({ error: { code: "unauthorized", message: "Please log in first." } }, 401);
    const store = authStore(context);
    await Promise.all([
      store.delete(`users/${user.id}.json`).catch(() => undefined),
      store.delete(authUserKey(user.email)).catch(() => undefined),
    ]);
    const sessions = await store.list({ prefix: "auth/sessions/" }).catch(() => ({ blobs: [] as Array<{ key: string }> }));
    await Promise.all(sessions.blobs.map(async (blob) => {
      const session = await store.get(blob.key, { type: "json" }) as AuthSession | null;
      if (session?.email === user.email) await store.delete(blob.key).catch(() => undefined);
    }));
    return new Response(JSON.stringify({ data: true }), { status: 200, headers: { ...PRIVATE_HEADERS, "set-cookie": authCookie("", 0) } });
  }
  if (request.method === "POST" && path === "/auth/logout") {
    const token = authToken(request);
    if (token) await authStore(context).delete(authSessionKey(token)).catch(() => undefined);
    return new Response(JSON.stringify({ data: true }), { status: 200, headers: { ...PRIVATE_HEADERS, "set-cookie": authCookie("", 0) } });
  }
  if (request.method !== "POST") return privateJson({ error: { code: "method_not_allowed", message: "Method not allowed." } }, 405);
  const body = await parseBody(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
    return privateJson({ error: { code: "validation_error", message: "Email or password is invalid." } }, 422);
  }
  const store = authStore(context);
  const key = authUserKey(email);
  const existing = await store.get(key, { type: "json" }) as AuthRecord | null;
  if (path === "/auth/signup") {
    if (existing) return privateJson({ error: { code: "account_exists", message: "Account already exists." } }, 409);
    const salt = randomSalt();
    const now = new Date().toISOString();
    const record: AuthRecord = {
      id: crypto.randomUUID(),
      email,
      name: String(body.name || "").trim() || email.split("@")[0],
      pictureUrl: null,
      confirmedAt: now,
      salt,
      password_hash: await passwordHash(password, salt),
      created_at: now,
    };
    await store.setJSON(key, record);
    return authSessionResponse(await createAuthSession(record, context));
  }
  if (path === "/auth/login") {
    if (!existing) {
      return privateJson({ error: { code: "invalid_login", message: "Email or password is incorrect." } }, 401);
    }
    const verification = await verifyPassword(password, existing);
    if (!verification.valid) return privateJson({ error: { code: "invalid_login", message: "Email or password is incorrect." } }, 401);
    if (verification.needs_upgrade) {
      const salt = randomSalt();
      existing.salt = salt;
      existing.password_hash = await passwordHash(password, salt);
      existing.updated_at = new Date().toISOString();
      await store.setJSON(key, existing);
    }
    return authSessionResponse(await createAuthSession(existing, context));
  }
  return privateJson({ error: { code: "not_found", message: "Not found." } }, 404);
}

async function userState(request: Request, context: Context): Promise<Response> {
  const user = await currentUser(request, context);
  if (!user) return privateJson({ error: { code: "unauthorized", message: "Please log in first." } }, 401);
  const store = authStore(context);
  const key = `users/${user.id}.json`;
  if (request.method === "GET") {
    const state = await store.get(key, { type: "json" });
    return privateJson({ data: state || emptyUserState() });
  }
  if (request.method !== "PUT" && request.method !== "PATCH") return privateJson({ error: { code: "method_not_allowed", message: "Method not allowed." } }, 405);
  const body = await parseBody(request);
  const incoming = request.method === "PATCH" ? body.patch : body.state;
  if (!incoming || typeof incoming !== "object" || JSON.stringify(incoming).length > 250000) {
    return privateJson({ error: { code: "validation_error", message: "Invalid user state." } }, 422);
  }
  const current = await store.get(key, { type: "json" }) as Record<string, unknown> | null;
  const base = request.method === "PATCH" ? { ...emptyUserState(), ...(current || {}) } : {};
  const saved = {
    ...base,
    ...(incoming as Record<string, unknown>),
    account_email: user.email,
    state_revision: Number(current?.state_revision || 0) + 1,
    updated_at: new Date().toISOString(),
  };
  await store.setJSON(key, saved);
  return privateJson({ data: saved });
}

async function sendAlertTest(request: Request, context: Context): Promise<Response> {
  if (request.method !== "POST") return privateJson({ error: { code: "method_not_allowed", message: "Method not allowed." } }, 405);
  const user = await currentUser(request, context);
  if (!user?.email) return privateJson({ error: { code: "unauthorized", message: "Please log in first." } }, 401);
  const body = await parseBody(request);
  const language = body.language === "en" ? "en" : "zh";
  const zh = language !== "en";
  const sent = await sendEmail(
    user.email,
    zh ? "Orivane 测试提醒" : "Orivane test alert",
    `<h2>${zh ? "测试提醒已发送成功" : "Test alert delivered"}</h2><p>${zh ? "你的邮件提醒服务已配置完成。之后价格提醒和每日摘要会发送到这个邮箱。" : "Your email alert service is configured. Price alerts and daily summaries will be sent to this address."}</p>`,
  );
  if (!sent) return error(503, "email_unavailable", zh ? "邮件服务暂不可用，请确认 Resend 配置。" : "Email service is unavailable. Check Resend configuration.");
  return json({ data: { sent: true, email: user.email } });
}

type AlertMarketSnapshot = {
  symbol: string;
  data_as_of: string;
  price: number;
  change: number;
  signal: string;
  confidence: number | null;
  invalidation: number | null;
  forecast_1d: number | null;
  forecast_5d: number | null;
  forecast_1m: number | null;
};

async function alertMarketSnapshot(symbol: string): Promise<AlertMarketSnapshot | null> {
  try {
    const asset = await resolveAsset(symbol);
    const start = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
    const history = await cachedPublicHistory(asset.symbol, start, asset.data_source, asset.asset_type) as {
      data_as_of?: string;
      snapshot?: Record<string, unknown>;
    };
    const forecast = await readFrozenCloudForecast(asset.symbol, String(history.data_as_of || "")).catch(() => null);
    return {
      symbol: asset.symbol,
      data_as_of: String(history.data_as_of || "").slice(0, 10),
      price: Number(history.snapshot?.latest_price || 0),
      change: Number(history.snapshot?.return_1d || 0),
      signal: String(forecast?.signal || "Observe"),
      confidence: toNumber(forecast?.confidence_score),
      invalidation: toNumber((forecast?.key_levels as Record<string, unknown> | undefined)?.invalidation),
      forecast_1d: toNumber(forecast?.forecast_1d_return),
      forecast_5d: toNumber(forecast?.forecast_5d_return),
      forecast_1m: toNumber(forecast?.forecast_1m_return),
    };
  } catch {
    return null;
  }
}

function alertTriggered(alert: Record<string, unknown>, current: AlertMarketSnapshot, previous?: Record<string, unknown>): boolean {
  const type = String(alert.type || "");
  const value = Number(alert.value);
  if (type === "above") return Number.isFinite(value) && current.price >= value;
  if (type === "below") return Number.isFinite(value) && current.price <= value;
  if (type === "change") return Number.isFinite(value) && Math.abs(current.change * 100) >= Math.abs(value);
  if (type === "signal") return Boolean(previous?.signal && current.signal !== "Observe" && current.signal !== String(previous.signal));
  if (type === "confidence") return Number.isFinite(value) && current.confidence !== null && toNumber(previous?.confidence) !== null
    && Math.abs(current.confidence - Number(previous?.confidence)) >= Math.abs(value);
  if (type === "invalidation") {
    if (current.invalidation === null || current.forecast_1d === null) return false;
    return current.forecast_1d >= 0 ? current.price <= current.invalidation : current.price >= current.invalidation;
  }
  return false;
}

function alertDescription(type: string, language: "zh" | "en"): string {
  const zh = language === "zh";
  return ({
    above: zh ? "价格突破上限" : "Price crossed above",
    below: zh ? "价格跌破下限" : "Price crossed below",
    change: zh ? "单日波动达到阈值" : "Daily move reached threshold",
    signal: zh ? "预测方向发生反转" : "Forecast direction reversed",
    confidence: zh ? "预测可信度显著变化" : "Forecast confidence changed",
    invalidation: zh ? "价格触及预测失效位" : "Forecast invalidation was breached",
  } as Record<string, string>)[type] || (zh ? "提醒已触发" : "Alert triggered");
}

function notificationPreferences(state: Record<string, unknown>): Record<string, unknown> {
  const stored = state.notification_preferences && typeof state.notification_preferences === "object"
    ? state.notification_preferences as Record<string, unknown>
    : {};
  return {
    email_enabled: stored.email_enabled !== false,
    browser_enabled: stored.browser_enabled === true,
    daily_digest: stored.daily_digest !== false,
    quiet_hours_enabled: stored.quiet_hours_enabled !== false,
    quiet_start: /^\d{2}:\d{2}$/.test(String(stored.quiet_start || "")) ? stored.quiet_start : "22:00",
    quiet_end: /^\d{2}:\d{2}$/.test(String(stored.quiet_end || "")) ? stored.quiet_end : "08:00",
    timezone: String(stored.timezone || "Asia/Shanghai"),
    min_interval_minutes: Math.min(1440, Math.max(0, Number(stored.min_interval_minutes || 60))),
  };
}

function inQuietHours(preferences: Record<string, unknown>, now = new Date()): boolean {
  if (preferences.quiet_hours_enabled !== true) return false;
  let time = "";
  try {
    time = new Intl.DateTimeFormat("en-GB", { timeZone: String(preferences.timezone), hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  } catch {
    time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  }
  const current = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const minutes = (value: unknown) => Number(String(value).slice(0, 2)) * 60 + Number(String(value).slice(3, 5));
  const start = minutes(preferences.quiet_start);
  const end = minutes(preferences.quiet_end);
  return start === end ? false : start < end ? current >= start && current < end : current >= start || current < end;
}

async function processAlerts(request: Request, context: Context): Promise<Response> {
  if (request.method !== "POST") return error(405, "method_not_allowed", "Method not allowed.");
  const token = (process.env.ORIVANE_OPTIMIZER_TOKEN || "").trim();
  if (!token || request.headers.get("authorization") !== `Bearer ${token}`) return error(403, "forbidden", "Job token required.");
  const store = authStore(context);
  const listed = await store.list({ prefix: "users/" });
  const keys = listed.blobs.map((blob) => blob.key).filter((key) => key.endsWith(".json")).slice(0, 500);
  const marketCache = new Map<string, Promise<AlertMarketSnapshot | null>>();
  let emailsSent = 0;
  let alertsTriggered = 0;
  let usersProcessed = 0;
  for (const key of keys) {
    const state = await store.get(key, { type: "json" }) as Record<string, unknown> | null;
    const email = normalizeEmail(state?.account_email);
    if (!state || !email) continue;
    usersProcessed += 1;
    const watchlists = Array.isArray(state.watchlists) ? state.watchlists as Array<Record<string, unknown>> : [];
    const alerts = Array.isArray(state.alerts) ? state.alerts as Array<Record<string, unknown>> : [];
    const symbols = [...new Set([
      ...watchlists.flatMap((list) => Array.isArray(list.symbols) ? list.symbols.map(String) : []),
      ...alerts.filter((alert) => alert.enabled !== false).map((alert) => String(alert.symbol || "")),
    ].map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].slice(0, 25);
    const snapshots = state.forecast_snapshots && typeof state.forecast_snapshots === "object" ? state.forecast_snapshots as Record<string, Record<string, unknown>> : {};
    const lastNotified = state.last_notified && typeof state.last_notified === "object" ? state.last_notified as Record<string, string> : {};
    const lastNotifiedAt = state.last_notified_at && typeof state.last_notified_at === "object" ? state.last_notified_at as Record<string, string> : {};
    const preferences = notificationPreferences(state);
    const quiet = inQuietHours(preferences);
    const loaded = (await Promise.all(symbols.map(async (symbol) => {
      if (!marketCache.has(symbol)) marketCache.set(symbol, alertMarketSnapshot(symbol));
      return marketCache.get(symbol)!;
    }))).filter((item): item is AlertMarketSnapshot => Boolean(item?.data_as_of && item.price));
    const bySymbol = new Map(loaded.map((item) => [item.symbol, item]));
    const triggered = alerts.filter((alert) => {
      if (alert.enabled === false) return false;
      const current = bySymbol.get(String(alert.symbol || "").toUpperCase());
      const id = String(alert.id || "");
      const lastAt = new Date(lastNotifiedAt[id] || 0).getTime();
      const intervalReady = !lastAt || Date.now() - lastAt >= Number(preferences.min_interval_minutes) * 60000;
      return Boolean(!quiet && intervalReady && current && id && lastNotified[id] !== current.data_as_of && alertTriggered(alert, current, snapshots[current.symbol]));
    });
    const latestMarketDate = loaded.map((item) => item.data_as_of).sort().at(-1) || "";
    const dailyKey = `daily:${latestMarketDate}`;
    const includeDaily = !quiet && preferences.email_enabled === true && preferences.daily_digest !== false && state.daily_summary_enabled !== false && Boolean(latestMarketDate) && lastNotified.daily_summary !== dailyKey;
    const language = state.preferred_language === "en" ? "en" : "zh";
    if (triggered.length || includeDaily) {
      const alertRows = triggered.map((alert) => {
        const current = bySymbol.get(String(alert.symbol || "").toUpperCase())!;
        return `<li><strong>${current.symbol}</strong> ${alertDescription(String(alert.type), language)} · ${current.price.toFixed(2)} · ${(current.change * 100).toFixed(2)}%</li>`;
      }).join("");
      const summaryRows = includeDaily ? loaded.map((item) => `<li><strong>${item.symbol}</strong> ${item.price.toFixed(2)} · ${(item.change * 100).toFixed(2)}% · ${language === "zh" ? "预测" : "forecast"} ${item.signal} · 1D ${item.forecast_1d === null ? "—" : `${(item.forecast_1d * 100).toFixed(2)}%`} · 5D ${item.forecast_5d === null ? "—" : `${(item.forecast_5d * 100).toFixed(2)}%`} · 1M ${item.forecast_1m === null ? "—" : `${(item.forecast_1m * 100).toFixed(2)}%`}</li>`).join("") : "";
      const shouldEmail = preferences.email_enabled === true && (Boolean(alertRows) || Boolean(summaryRows));
      const sent = shouldEmail ? await sendEmail(
        email,
        language === "zh" ? `Orivane ${triggered.length ? "提醒与" : ""}每日摘要` : `Orivane ${triggered.length ? "alerts and " : ""}daily digest`,
        `${alertRows ? `<h2>${language === "zh" ? "已触发提醒" : "Triggered alerts"}</h2><ul>${alertRows}</ul>` : ""}${summaryRows ? `<h2>${language === "zh" ? "观察列表摘要" : "Watchlist digest"}</h2><ul>${summaryRows}</ul>` : ""}<p>${language === "zh" ? "预测仅用于研究参考，不构成投资建议。" : "Forecasts are for research only and are not investment advice."}</p>`,
      ) : false;
      if (sent) emailsSent += 1;
      if (includeDaily && sent) lastNotified.daily_summary = dailyKey;
      if (triggered.length) {
        const triggeredAt = new Date().toISOString();
        alertsTriggered += triggered.length;
        triggered.forEach((alert) => {
          const id = String(alert.id);
          lastNotified[id] = bySymbol.get(String(alert.symbol).toUpperCase())!.data_as_of;
          lastNotifiedAt[id] = triggeredAt;
        });
        const history = Array.isArray(state.alert_history) ? state.alert_history as Array<Record<string, unknown>> : [];
        state.alert_history = [...triggered.map((alert) => {
          const current = bySymbol.get(String(alert.symbol).toUpperCase())!;
          const description = alertDescription(String(alert.type), language);
          return {
            ...alert,
            price: current.price,
            change: current.change,
            triggered_at: triggeredAt,
            read_at: null,
            deep_link: `/stocks/${current.symbol.toLowerCase().replaceAll(".", "-")}/`,
            title: `${current.symbol} · ${description}`,
            body: `${language === "zh" ? "价格" : "Price"} ${current.price.toFixed(2)} · ${(current.change * 100).toFixed(2)}%`,
          };
        }), ...history].slice(0, 100);
      }
    }
    state.forecast_snapshots = Object.fromEntries(loaded.map((item) => [item.symbol, { signal: item.signal, confidence: item.confidence, invalidation: item.invalidation, data_as_of: item.data_as_of }]));
    state.last_notified = lastNotified;
    state.last_notified_at = lastNotifiedAt;
    state.notification_preferences = preferences;
    state.updated_at = new Date().toISOString();
    await store.setJSON(key, state);
  }
  return json({ data: { users_processed: usersProcessed, emails_sent: emailsSent, alerts_triggered: alertsTriggered, finished_at: new Date().toISOString() } });
}

async function eastmoneyFundHistory(symbol: string, start: string): Promise<Record<string, unknown>> {
  const script = await eastmoneyFundScript(symbol);
  const match = script.match(/var Data_netWorthTrend = (\[[\s\S]*?\]);/);
  if (!match) throw new Error("No fund NAV history is available.");
  const startTime = new Date(`${start}T00:00:00Z`).getTime();
  const points = (JSON.parse(match[1]) as Array<{ x: number; y: number }>).filter((point) => point.x >= startTime && Number.isFinite(point.y));
  if (!points.length) throw new Error("No fund NAV history is available.");
  const values = points.map((point) => point.y);
  const empty = values.map(() => null);
  const records = technicalRecords(
    points.map((point) => Math.floor(point.x / 1000)),
    { open: values, high: values, low: values, close: values, volume: empty },
    values,
  );
  const returns = records.map((row) => Number(row.Daily_Return)).slice(-20);
  return {
    symbol,
    data_source: "eastmoney",
    source_description: "Eastmoney cloud fund NAV data",
    data_as_of: String(records.at(-1)?.Date),
    snapshot: {
      latest_price: values.at(-1),
      return_1d: values.length > 1 ? values.at(-1)! / values.at(-2)! - 1 : null,
      return_5d: values.length > 5 ? values.at(-1)! / values.at(-6)! - 1 : null,
      annualized_volatility_20d: returns.length > 1 ? standardDeviation(returns)! * Math.sqrt(252) : null,
    },
    records,
  };
}

async function publicHistory(symbol: string, start: string, source: string, assetType: string): Promise<Record<string, unknown>> {
  if (source === "yahoo") return marketHistoryFallback(symbol, start);
  if (source === "akshare" && assetType === "stock") return marketHistoryFallback(symbol, start);
  if (source === "eastmoney" || assetType === "fund") return eastmoneyFundHistory(symbol, start);
  throw new Error("该资产暂未接入云端行情。");
}

async function cachedPublicHistory(symbol: string, start: string, source: string, assetType: string): Promise<Record<string, unknown>> {
  const year = new Date().getUTCFullYear();
  const recentStart = `${year - 4}-01-01`;
  const longStart = `${year - 12}-01-01`;
  const window = start >= recentStart
    ? { key: `recent-${year - 4}`, start: recentStart }
    : start >= longStart
      ? { key: `long-${year - 12}`, start: longStart }
      : { key: "max", start: "1900-01-01" };
  const fullHistory = await cachedValue(`history-v5/${window.key}/${symbol}/${source}/${assetType}`, 30 * 60, () => publicHistory(symbol, window.start, source, assetType));
  const records = Array.isArray(fullHistory.records) ? fullHistory.records as HistoryRecord[] : [];
  const filtered = records.filter((row) => String(row.Date || "") >= start);
  return { ...fullHistory, records: filtered.length ? filtered : records };
}

function liteHistory(history: Record<string, unknown>): Record<string, unknown> {
  const records = Array.isArray(history.records) ? history.records as HistoryRecord[] : [];
  return {
    symbol: history.symbol,
    data_source: history.data_source,
    data_as_of: history.data_as_of,
    snapshot: history.snapshot,
    records: records.map((row) => ({ Date: String(row.Date || ""), Price: Number(row.Price) })),
  };
}

function periodReturns(history: Record<string, unknown>): Record<string, number | null> {
  const rows = (Array.isArray(history.records) ? history.records as HistoryRecord[] : [])
    .filter((row) => String(row.Date || "") && Number.isFinite(Number(row.Price)) && Number(row.Price) > 0)
    .sort((left, right) => String(left.Date).localeCompare(String(right.Date)));
  if (rows.length < 2) return Object.fromEntries(["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "10Y", "MAX"].map((key) => [key, null]));
  const latest = rows.at(-1)!;
  const latestDate = new Date(`${String(latest.Date)}T00:00:00Z`);
  const threshold = (range: string): string => {
    const date = new Date(latestDate);
    if (range === "YTD") date.setUTCMonth(0, 1);
    else date.setUTCDate(date.getUTCDate() - ({ "1M": 31, "6M": 186, "1Y": 366, "5Y": 1827, "10Y": 3653 }[range] || 366));
    return date.toISOString().slice(0, 10);
  };
  const valueFor = (range: string): number | null => {
    const baseline = range === "1D" ? rows.at(-2)
      : range === "5D" ? rows.at(-6) || rows[0]
        : range === "MAX" ? rows[0]
          : rows.find((row) => String(row.Date) >= threshold(range)) || rows[0];
    const price = Number(baseline?.Price);
    return Number.isFinite(price) && price > 0 ? Number(latest.Price) / price - 1 : null;
  };
  return Object.fromEntries(["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "10Y", "MAX"].map((range) => [range, valueFor(range)]));
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const type = request.headers.get("content-type") || "";
    if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(await request.text()));
    return await request.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

class AiRequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function stringHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function clientQuotaKey(request: Request): string {
  const raw = request.headers.get("x-nf-client-connection-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]
    || request.headers.get("cf-connecting-ip")
    || "anonymous";
  return stringHash(raw.trim().toLowerCase());
}

async function enforceAiQuota(request: Request): Promise<void> {
  try {
    const store = getStore({ name: "orivane-ai-usage", consistency: "strong" });
    const key = `daily/${metricDate()}/${clientQuotaKey(request)}.json`;
    const current = await store.get(key, { type: "json" }) as { count?: number; updated_at?: string } | null;
    const count = Number(current?.count || 0);
    if (count >= aiDailyLimit()) throw new AiRequestError(429, "ai_quota_exceeded", "今日 AI 解读次数已用完，请明天再试。");
    await store.setJSON(key, { count: count + 1, updated_at: new Date().toISOString() });
  } catch (cause) {
    if (cause instanceof AiRequestError) throw cause;
  }
}

function stringList(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 5);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return fallback;
}

function parseGeminiJson(text: string): Record<string, unknown> {
  const parseValue = (value: string, depth = 0): unknown => {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] || value;
    const trimmed = fenced.trim();
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "string" && depth < 2) return parseValue(parsed, depth + 1);
      return parsed;
    } catch {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
        if (typeof parsed === "string" && depth < 2) return parseValue(parsed, depth + 1);
        return parsed;
      }
      throw new Error("Invalid Gemini JSON.");
    }
  };
  const parsed = parseValue(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid Gemini JSON.");
  return parsed as Record<string, unknown>;
}

function latestTechnicalSnapshot(history: { snapshot: Record<string, unknown>; records: HistoryRecord[] }): Record<string, unknown> {
  const latest = history.records.at(-1) || {};
  return {
    data_as_of: history.snapshot.data_as_of || latest.Date,
    latest_price: history.snapshot.latest_price ?? latest.Price,
    return_1d: history.snapshot.return_1d,
    return_5d: history.snapshot.return_5d,
    annualized_volatility_20d: history.snapshot.annualized_volatility_20d,
    ma_20: latest.MA_20,
    ma_50: latest.MA_50,
    rsi_14: latest.RSI_14,
    macd_hist: latest.MACD_Hist,
    volume: latest.Volume,
  };
}

function recentTechnicalLevels(history: { snapshot: Record<string, unknown>; records: HistoryRecord[] }): Record<string, unknown> {
  const rows = history.records.filter((row) => Number.isFinite(Number(row.Price)));
  const latest = rows.at(-1) || {};
  const recent5 = rows.slice(-5).map((row) => Number(row.Price));
  const recent20 = rows.slice(-20).map((row) => Number(row.Price));
  const latestPrice = Number(history.snapshot.latest_price ?? latest.Price);
  const volatility = Number(history.snapshot.annualized_volatility_20d || 0) / Math.sqrt(252);
  return {
    latest_price: Number.isFinite(latestPrice) ? latestPrice : null,
    ma_20: latest.MA_20,
    ma_50: latest.MA_50,
    recent_5d_low: recent5.length ? Math.min(...recent5) : null,
    recent_20d_low: recent20.length ? Math.min(...recent20) : null,
    recent_20d_high: recent20.length ? Math.max(...recent20) : null,
    volatility_stop_reference: Number.isFinite(latestPrice) && Number.isFinite(volatility) && volatility > 0 ? latestPrice * (1 - 2 * volatility) : null,
  };
}

function aiPrompt(input: {
  language: AiLanguage;
  asset: Asset;
  history: { data_as_of?: string; snapshot: Record<string, unknown>; records: HistoryRecord[] };
  forecast: Record<string, unknown>;
  predictionHistory: Record<string, unknown> | null;
  performance: Record<string, unknown> | null;
  question: string;
  conversation?: Array<{ role: string; content: string }>;
}): string {
  const stats = Array.isArray(input.predictionHistory?.statistics)
    ? (input.predictionHistory.statistics as Record<string, unknown>[]).find((item) => String(item.window) === "All") || null
    : null;
  const context = {
    asset: {
      symbol: input.asset.symbol,
      name: input.asset.name,
      name_zh: input.asset.name_zh,
      asset_type: input.asset.asset_type,
      exchange: input.asset.exchange,
      currency: input.asset.currency,
    },
    levels: recentTechnicalLevels(input.history),
    market: latestTechnicalSnapshot(input.history),
    forecast: {
      model: input.forecast.best_model,
      signal: input.forecast.signal,
      signal_quality: input.forecast.signal_quality,
      forecast_1d_return: input.forecast.forecast_1d_return,
      forecast_5d_return: input.forecast.forecast_5d_return,
      forecast_10d_return: input.forecast.forecast_10d_return,
      forecast_1m_return: input.forecast.forecast_1m_return,
      confidence_score: input.forecast.confidence_score,
      validation_sample_size: input.forecast.validation_sample_size,
      data_as_of: input.forecast.data_as_of,
      generated_at: input.forecast.generated_at,
      calibration: input.forecast.calibration,
      model_components: input.forecast.model_components,
      market_regime: input.forecast.market_regime,
      action: input.forecast.action,
      key_levels: input.forecast.key_levels,
      scenarios: input.forecast.scenarios,
      drivers_zh: input.forecast.drivers_zh,
      drivers_en: input.forecast.drivers_en,
    },
    validation: {
      live_completed: stats?.completed ?? 0,
      live_direction_accuracy: stats?.direction_accuracy ?? null,
      majority_baseline_accuracy: stats?.majority_baseline_accuracy ?? null,
      mean_absolute_return_error: stats?.mean_absolute_return_error ?? null,
      backtest_samples: (input.performance?.backtest as { test_samples?: unknown } | undefined)?.test_samples ?? null,
    },
    user_question: input.question || null,
    conversation: (input.conversation || []).slice(-8),
  };
  const zh = input.language === "zh";
  const followUp = Boolean(input.question.trim());
  return [
    zh
      ? "你是 Orivane 的市场预测助手。只基于提供的数据做走势预测、操作参考、风险提示和关键观察点；不要把结论说成确定收益。"
      : "You are Orivane's market forecasting assistant. Use only the supplied data to provide trend forecasts, action references, risk notes and watch items; do not present outcomes as guaranteed.",
    followUp
      ? (zh
        ? "当前是后续聊天模式。你要像专业基金经理/投研经理一样直接回答 user_question，语气自然、具体、有判断。不要输出“预测解读、可信度说明、主要风险、后续观察”这类固定栏目，也不要复读首次解读。summary 必须是一段完整回答，优先回应用户问题；涉及止损、买入、卖出时，优先使用 key_levels、action 和 scenarios 里的价位、情景和失效条件。forecast_read、confidence_notes、risks、watch_items 除非真的必要，否则返回空数组。"
        : "This is follow-up chat mode. Answer user_question directly like a professional portfolio manager/research manager: natural, specific, judgment-oriented. Do not output fixed sections such as Forecast read, Confidence notes, Key risks, What to watch, and do not repeat the initial briefing. summary must be a complete answer. For stop-loss, buy or sell questions, give reference levels or triggers from levels, moving averages, recent lows/highs and volatility. Keep forecast_read, confidence_notes, risks and watch_items empty unless truly necessary.")
      : (zh
        ? "当前是首次解读模式。可以用结构化方式输出预测解读、可信度、风险和后续观察。"
        : "This is initial briefing mode. Use structured forecast read, confidence, risk and watch items."),
    zh
      ? "如果验证样本很少、预测过期或信号弱，必须明确降低结论强度。"
      : "If validation samples are sparse, stale, or weak, explicitly lower the strength of the conclusion.",
    followUp
      ? (zh
        ? "直接返回自然、专业的中文回答，不要 JSON，不要固定栏目；可以分成简短段落。"
        : "Return a natural, professional answer directly. Do not use JSON or fixed sections; short paragraphs are allowed.")
      : (zh
        ? "返回严格 JSON，不要 Markdown。字段：summary 字符串；forecast_read、confidence_notes、risks、watch_items、questions 都是字符串数组，每个最多 4 条。"
        : "Return strict JSON, no Markdown. Fields: summary string; forecast_read, confidence_notes, risks, watch_items, questions as string arrays, max 4 items each."),
    zh ? "语言必须全部使用中文。" : "Use English only.",
    JSON.stringify(context),
  ].join("\n\n");
}

function normalizeAiAnalysis(raw: Record<string, unknown>, meta: Pick<AiAnalysis, "symbol" | "model" | "language">): AiAnalysis {
  const nested = typeof raw.summary === "string" && raw.summary.trim().startsWith("{")
    ? (() => { try { return parseGeminiJson(raw.summary as string); } catch { return null; } })()
    : null;
  const source = nested || raw;
  const fallbackSummary = meta.language === "zh"
    ? "AI 已根据当前行情、预测和验证数据生成研究解读。"
    : "AI generated a research read from the current market, forecast and validation data.";
  const summary = String(source.summary || "").trim();
  return {
    symbol: meta.symbol,
    provider: "gemini",
    model: meta.model,
    generated_at: new Date().toISOString(),
    language: meta.language,
    source: "gemini",
    fallback_reason: null,
    summary: summary.startsWith("{") ? fallbackSummary : (summary || fallbackSummary),
    forecast_read: stringList(source.forecast_read),
    confidence_notes: stringList(source.confidence_notes),
    risks: stringList(source.risks),
    watch_items: stringList(source.watch_items),
    questions: stringList(source.questions),
  };
}

function structuredForecastRead(input: {
  language: AiLanguage;
  asset: Asset;
  history: { data_as_of?: string; snapshot: Record<string, unknown>; records: HistoryRecord[] };
  forecast: Record<string, unknown>;
  question?: string;
}, model: string): AiAnalysis {
  const zh = input.language === "zh";
  const f1 = Number(input.forecast.forecast_1d_return || 0);
  const f5 = Number(input.forecast.forecast_5d_return || 0);
  const f10 = Number(input.forecast.forecast_10d_return ?? f5);
  const f1m = Number(input.forecast.forecast_1m_return ?? f10);
  const confidence = Number(input.forecast.confidence_score ?? 50);
  const calibration = input.forecast.calibration as ForecastCalibration | undefined;
  const latestPrice = Number(input.history.snapshot.latest_price || input.history.records.at(-1)?.Price || 0);
  const levels = recentTechnicalLevels(input.history);
  const forecastLevels = input.forecast.key_levels as ForecastKeyLevels | undefined;
  const forecastScenarios = Array.isArray(input.forecast.scenarios) ? input.forecast.scenarios as ForecastScenario[] : [];
  const action = input.forecast.action as ForecastAction | undefined;
  const kline = input.forecast.kline_forecast as KlineForecastSignal | undefined;
  const expectedRange = input.forecast.expected_range_1m as ForecastExpectedRange | undefined;
  const ma20 = Number(levels.ma_20);
  const ma50 = Number(levels.ma_50);
  const low5 = Number(levels.recent_5d_low);
  const low20 = Number(forecastLevels?.support ?? levels.recent_20d_low);
  const high20 = Number(forecastLevels?.resistance ?? levels.recent_20d_high);
  const volStop = Number(forecastLevels?.stop_loss ?? levels.volatility_stop_reference);
  const levelText = [ma20, ma50, low5, low20, volStop].filter(Number.isFinite).map((value) => value.toFixed(2));
  const question = String(input.question || "").toLowerCase();
  const bias = f1m > 0.015 && confidence >= 55 ? "bullish" : f1m < -0.015 && confidence >= 55 ? "bearish" : f1m >= 0 ? "mild_bullish" : "mild_bearish";
  const stopZh = `如果已经持有，参考止损区间优先看 ${Number.isFinite(ma20) ? ma20.toFixed(2) : "20日均线"}、${Number.isFinite(low20) ? low20.toFixed(2) : "20日低点"} 和 ${Number.isFinite(volStop) ? volStop.toFixed(2) : "波动率止损位"}；有效跌破说明预测失效概率上升。`;
  const entryZh = bias === "bullish"
    ? `不建议无条件追涨。1个月预测为 ${pct(f1m)}，偏多但更适合等回踩 ${Number.isFinite(ma20) ? ma20.toFixed(2) : "20日均线"} 附近不破，或放量突破 ${Number.isFinite(high20) ? high20.toFixed(2) : "近20日高点"} 后再分批。`
    : `现在更偏等待。1个月预测为 ${pct(f1m)}，强度不足，优先看能否重新站稳 ${Number.isFinite(ma20) ? ma20.toFixed(2) : "20日均线"}，否则不适合追涨。`;
  const riskZh = `这个预测最怕三类情况：跌破 ${Number.isFinite(ma20) ? ma20.toFixed(2) : "20日均线"} 后无法收回、成交量放大但价格不涨、以及 5日/10日/1个月预测开始转弱。`;
  const stopEn = `If already holding, watch ${Number.isFinite(ma20) ? ma20.toFixed(2) : "the 20-day average"}, ${Number.isFinite(low20) ? low20.toFixed(2) : "the 20-day low"} and ${Number.isFinite(volStop) ? volStop.toFixed(2) : "the volatility stop"} as stop reference levels; confirmed breaks raise forecast failure risk.`;
  const entryEn = bias === "bullish"
    ? `Do not chase blindly. The 1-month forecast is ${pct(f1m)}; prefer a pullback that holds ${Number.isFinite(ma20) ? ma20.toFixed(2) : "the 20-day average"} or a volume-backed break above ${Number.isFinite(high20) ? high20.toFixed(2) : "the 20-day high"} before staging entries.`
    : `Waiting is cleaner now. The 1-month forecast is ${pct(f1m)} and strength is limited; first watch whether price can reclaim ${Number.isFinite(ma20) ? ma20.toFixed(2) : "the 20-day average"}.`;
  const riskEn = `The forecast is most vulnerable to three conditions: failing below ${Number.isFinite(ma20) ? ma20.toFixed(2) : "the 20-day average"}, rising volume without price progress, and weakening 5D/10D/1M forecasts.`;
  const directZh = /止损|止盈|持有|卖/.test(question)
    ? stopZh
    : /追涨|等待|回调|买/.test(question)
      ? entryZh
      : /风险|失效|怕/.test(question)
        ? riskZh
        : "";
  const directEn = /stop|sell|hold/.test(question)
    ? stopEn
    : /buy|entry|wait|pullback|chase/.test(question)
      ? entryEn
      : /risk|break|fail|invalidate/.test(question)
        ? riskEn
        : "";
  const baseScenario = forecastScenarios.find((item) => item.name === "base");
  const summaryZh = directZh || action?.summary_zh || (bias === "bullish"
    ? `${input.asset.name_zh || input.asset.name} 短中期预测偏强，1个月预期收益 ${pct(f1m)}，适合重点观察回调后的分批机会。`
    : bias === "bearish"
      ? `${input.asset.name_zh || input.asset.name} 短中期预测偏弱，1个月预期收益 ${pct(f1m)}，更适合先控制风险、等待趋势修复。`
      : `${input.asset.name_zh || input.asset.name} 当前预测强度一般，1个月预期收益 ${pct(f1m)}，更适合等待价格和成交量进一步确认。`);
  const summaryEn = directEn || action?.summary_en || (bias === "bullish"
    ? `${input.asset.name} has a constructive short-to-medium term forecast with a one-month expected return of ${pct(f1m)}. Watch for staged entries after pullbacks.`
    : bias === "bearish"
      ? `${input.asset.name} has a weak short-to-medium term forecast with a one-month expected return of ${pct(f1m)}. Prioritize risk control and wait for repair.`
      : `${input.asset.name} has a moderate forecast setup with a one-month expected return of ${pct(f1m)}. Wait for price and volume confirmation.`);
  const followUp = Boolean(question);
  const nextQuestionsZh = /止损|止盈|持有|卖/.test(question)
    ? ["如果跌破止损位，应该全部卖还是分批？", "如果重新站上均线，能否加仓？", "这只资产更适合短线还是波段？"]
    : /追涨|等待|回调|买/.test(question)
      ? ["如果等回调，第一观察位是多少？", "突破后追入的条件是什么？", "仓位应该一次买还是分批？"]
      : ["这个判断最容易错在哪里？", "如果明天高开该怎么处理？", "和同类资产相比它更强吗？"];
  const nextQuestionsEn = /stop|sell|hold/.test(question)
    ? ["If it breaks the stop, sell all or scale out?", "Can I add if it reclaims the average?", "Is this better as a short-term or swing setup?"]
    : /buy|entry|wait|pullback|chase/.test(question)
      ? ["What is the first pullback level to watch?", "What confirms a breakout entry?", "Should position sizing be staged?"]
      : ["Where can this view be wrong?", "How should I handle a gap up tomorrow?", "Is it stronger than peers?"];
  return {
    symbol: input.asset.symbol,
    provider: "gemini",
    model,
    generated_at: new Date().toISOString(),
    language: input.language,
    source: "structured_fallback",
    fallback_reason: "Gemini response was unavailable or could not be parsed as the required schema.",
    summary: zh ? summaryZh : summaryEn,
    forecast_read: followUp ? [] : (zh
      ? [`下一交易日预测 ${pct(f1)}。`, `未来 5 日累计预测 ${pct(f5)}。`, `未来 10 日累计预测 ${pct(f10)}。`, `未来 1 个月基准情景 ${pct(baseScenario?.expected_return ?? f1m)}。`, kline ? `${kline.label_zh}，K线序列得分 ${kline.score.toFixed(2)}。` : "", expectedRange ? `未来 1 个月预估区间 ${expectedRange.low.toFixed(2)} 至 ${expectedRange.high.toFixed(2)}。` : ""].filter(Boolean)
      : [`Next-session forecast is ${pct(f1)}.`, `Next 5-day cumulative forecast is ${pct(f5)}.`, `Next 10-day cumulative forecast is ${pct(f10)}.`, `Base-case 1-month forecast is ${pct(baseScenario?.expected_return ?? f1m)}.`, kline ? `${kline.label_en}; K-line sequence score is ${kline.score.toFixed(2)}.` : "", expectedRange ? `Estimated 1-month range is ${expectedRange.low.toFixed(2)} to ${expectedRange.high.toFixed(2)}.` : ""].filter(Boolean)),
    confidence_notes: followUp ? [] : (zh
      ? [`预测可信度 ${confidence}/100。`, calibration?.note_zh || `数据截至 ${input.forecast.data_as_of || input.history.data_as_of || "—"}。`, `当前价格 ${Number.isFinite(latestPrice) ? latestPrice.toFixed(2) : "—"}。`]
      : [`Forecast confidence is ${confidence}/100.`, calibration?.note_en || `Data as of ${input.forecast.data_as_of || input.history.data_as_of || "—"}.`, `Latest price is ${Number.isFinite(latestPrice) ? latestPrice.toFixed(2) : "—"}.`]),
    risks: followUp ? [] : (zh
      ? ["预测不是确定收益，需要结合大盘、行业和财报事件。", "如果价格跌破关键均线或放量下跌，应优先降低仓位冲动。", "短期波动可能导致预测方向失效。"]
      : ["Forecasts are not guaranteed returns and should be checked against market, sector and earnings events.", "If price breaks key averages on heavy volume, reduce entry urgency.", "Short-term volatility can invalidate the forecast direction."]),
    watch_items: followUp ? [] : (zh
      ? [`关键价位参考：${levelText.length ? levelText.join(" / ") : "等待更多行情数据"}。`, forecastLevels?.invalidation_zh || (Number.isFinite(high20) ? `若放量突破近 20 日高点 ${high20.toFixed(2)}，趋势确认度会提高。` : "观察价格是否站稳 20 日均线。"), "比较 5日、10日和1个月预测是否同向增强。"]
      : [`Reference levels: ${levelText.length ? levelText.join(" / ") : "wait for more market data"}.`, forecastLevels?.invalidation_en || (Number.isFinite(high20) ? `A volume-backed break above the 20-day high ${high20.toFixed(2)} would improve confirmation.` : "Watch whether price holds the 20-day average."), "Check whether 5D, 10D and 1M forecasts strengthen in the same direction."]),
    questions: followUp
      ? (zh ? nextQuestionsZh : nextQuestionsEn)
      : (zh
        ? ["如果我已经持有，应该看哪些止损位置？", "现在是追涨还是等回调？", "这个预测最怕什么风险？"]
        : ["If I already hold it, what stop levels matter?", "Chase now or wait for a pullback?", "What risk can break this forecast?"]),
  };
}

function geminiModelCandidates(): string[] {
  return [...new Set([configuredGeminiModel(), ...GEMINI_FALLBACK_MODELS].map((item) => item.trim()).filter(Boolean))];
}

async function callGeminiModel(model: string, prompt: string, apiKey: string, structured: boolean): Promise<string> {
  const thinkingConfig = model.startsWith("gemini-3")
    ? { thinkingLevel: "low" }
    : { thinkingBudget: 0 };
  const generationConfig = structured
    ? {
      temperature: 0.35,
      maxOutputTokens: 1800,
      thinkingConfig,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          summary: { type: "STRING" },
          forecast_read: { type: "ARRAY", items: { type: "STRING" } },
          confidence_notes: { type: "ARRAY", items: { type: "STRING" } },
          risks: { type: "ARRAY", items: { type: "STRING" } },
          watch_items: { type: "ARRAY", items: { type: "STRING" } },
          questions: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["summary", "forecast_read", "confidence_notes", "risks", "watch_items", "questions"],
      },
    }
    : { temperature: 0.45, maxOutputTokens: 1400, thinkingConfig };
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({})) as { error?: { message?: string }; candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }> };
  if (!response.ok) throw new Error(`Gemini ${model} returned ${response.status}${payload.error?.message ? `: ${payload.error.message}` : ""}.`);
  if (payload.candidates?.[0]?.finishReason === "MAX_TOKENS") throw new Error(`Gemini ${model} exhausted its output token budget.`);
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim() || "";
  if (!text) throw new Error(`Gemini ${model} returned an empty response.`);
  return text;
}

async function callGeminiModelStream(model: string, prompt: string, apiKey: string, structured: boolean, onToken: (token: string) => void): Promise<string> {
  const thinkingConfig = model.startsWith("gemini-3") ? { thinkingLevel: "low" } : { thinkingBudget: 0 };
  const generationConfig = structured
    ? { temperature: 0.35, maxOutputTokens: 1800, thinkingConfig, responseMimeType: "application/json" }
    : { temperature: 0.45, maxOutputTokens: 1400, thinkingConfig };
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(`Gemini ${model} returned ${response.status}${payload.error?.message ? `: ${payload.error.message}` : ""}.`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete = "";
  let finishReason = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const parsed = extractSseBlocks(buffer, done);
    buffer = parsed.rest;
    for (const block of parsed.blocks) {
      const raw = parseSseBlock(block).data;
      if (!raw || raw === "[DONE]") continue;
      const payload = JSON.parse(raw) as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
      finishReason = payload.candidates?.[0]?.finishReason || finishReason;
      const token = payload.candidates?.[0]?.content?.parts?.filter((part) => part.thought !== true).map((part) => part.text || "").join("") || "";
      if (!token) continue;
      complete += token;
      if (!structured) onToken(token);
    }
    if (done) break;
  }
  if (!complete.trim()) throw new Error(`Gemini ${model} returned an empty response${finishReason ? ` (${finishReason})` : ""}.`);
  return complete.trim();
}

async function geminiAnalysis(input: {
  language: AiLanguage;
  asset: Asset;
  history: { data_as_of?: string; snapshot: Record<string, unknown>; records: HistoryRecord[] };
  forecast: Record<string, unknown>;
  predictionHistory: Record<string, unknown> | null;
  performance: Record<string, unknown> | null;
  question: string;
  conversation?: Array<{ role: string; content: string }>;
}): Promise<AiAnalysis> {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim().replace(/^['"]|['"]$/g, "");
  if (!apiKey) throw new AiRequestError(503, "gemini_not_configured", "Gemini API Key 尚未配置。");
  const prompt = aiPrompt(input);
  const followUp = Boolean(input.question.trim());
  let modelUsed = configuredGeminiModel();
  let text = "";
  const errors: string[] = [];
  for (const model of geminiModelCandidates()) {
    try {
      text = await callGeminiModel(model, prompt, apiKey, !followUp);
      modelUsed = model;
      break;
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : String(cause));
    }
  }
  if (!text) throw new Error(errors.at(-1) || "Gemini unavailable.");
  if (followUp) {
    let summary = text.trim().replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
    try {
      const parsed = parseGeminiJson(summary);
      summary = String(parsed.summary || summary).trim();
    } catch {
      // Free-form follow-up responses are expected and should not trigger the template fallback.
    }
    const suggestions = structuredForecastRead(input, modelUsed).questions;
    return normalizeAiAnalysis({ summary, questions: suggestions }, { symbol: input.asset.symbol, model: modelUsed, language: input.language });
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parseGeminiJson(text);
  } catch {
    return structuredForecastRead(input, modelUsed);
  }
  const normalized = normalizeAiAnalysis(parsed, { symbol: input.asset.symbol, model: modelUsed, language: input.language });
  return normalized.forecast_read.length || normalized.watch_items.length ? normalized : structuredForecastRead(input, modelUsed);
}

async function loadAiAnalysisInput(symbol: string, language: AiLanguage, question: string, conversation: Array<{ role: string; content: string }>): Promise<Parameters<typeof geminiAnalysis>[0]> {
  const asset = await resolveAsset(symbol);
  const start = new Date(Date.now() - 450 * 86400000).toISOString().slice(0, 10);
  const [historyResult, forecastResult, cloudHistoryResult] = await Promise.allSettled([
    cachedPublicHistory(asset.symbol, start, asset.data_source, asset.asset_type),
    Promise.resolve(readFrozenCloudForecast(asset.symbol)).then((data) => data || generateAndFreezeCloudForecast(asset.symbol)),
    cloudLedgerHistory(asset.symbol),
  ]);
  if (historyResult.status !== "fulfilled") throw historyResult.reason;
  if (forecastResult.status !== "fulfilled") throw forecastResult.reason;
  const history = historyResult.value as { data_as_of?: string; snapshot: Record<string, unknown>; records: HistoryRecord[] };
  const forecast = forecastResult.value as Record<string, unknown>;
  const predictionHistory = cloudHistoryResult.status === "fulfilled" ? cloudHistoryResult.value : null;
  const forecastValidation = forecast.validation as { backtest?: Record<string, unknown> } | undefined;
  const performance = forecastValidation?.backtest
    ? { backtest: { best: { ...forecastValidation.backtest, Directional_Edge: forecastValidation.backtest.direction_edge }, test_samples: forecastValidation.backtest.samples } }
    : null;
  return { language, asset, history, forecast, predictionHistory, performance, question, conversation };
}

function parseAiRequestBody(body: Record<string, unknown>): { symbol: string; language: AiLanguage; question: string; conversation: Array<{ role: string; content: string }> } {
  return {
    symbol: String(body.symbol || "").trim().toUpperCase(),
    language: body.language === "en" ? "en" : "zh",
    question: String(body.question || "").trim().slice(0, 500),
    conversation: Array.isArray(body.conversation)
      ? body.conversation.slice(-12).map((item) => ({
        role: String((item as Record<string, unknown>).role || "").slice(0, 20),
        content: String((item as Record<string, unknown>).content || "").slice(0, 1200),
      })).filter((item) => item.content)
      : [],
  };
}

function sseEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function aiAnalysisStreamResponse(request: Request): Promise<Response> {
  if (request.method !== "POST") return privateJson({ error: { code: "method_not_allowed", message: "Method not allowed." } }, 405);
  const parsed = parseAiRequestBody(await parseBody(request));
  if (!parsed.symbol) return privateJson({ error: { code: "validation_error", message: "Symbol is required." } }, 422);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await enforceAiQuota(request);
        const input = await loadAiAnalysisInput(parsed.symbol, parsed.language, parsed.question, parsed.conversation);
        const apiKey = (process.env.GEMINI_API_KEY || "").trim().replace(/^['"]|['"]$/g, "");
        if (!apiKey) throw new AiRequestError(503, "gemini_not_configured", "Gemini API Key 尚未配置。");
        const structured = !parsed.question;
        const prompt = aiPrompt(input);
        let text = "";
        let modelUsed = configuredGeminiModel();
        const errors: string[] = [];
        for (const model of geminiModelCandidates()) {
          try {
            text = await callGeminiModelStream(model, prompt, apiKey, structured, (token) => controller.enqueue(sseEvent("token", { text: token })));
            modelUsed = model;
            break;
          } catch (cause) {
            errors.push(cause instanceof Error ? cause.message : String(cause));
          }
        }
        if (!text) {
          for (const model of geminiModelCandidates()) {
            try {
              text = await callGeminiModel(model, prompt, apiKey, structured);
              modelUsed = model;
              break;
            } catch (cause) {
              errors.push(cause instanceof Error ? cause.message : String(cause));
            }
          }
        }
        if (!text) throw new Error(errors.at(-1) || "Gemini unavailable.");
        let data: AiAnalysis;
        if (structured) {
          try { data = normalizeAiAnalysis(parseGeminiJson(text), { symbol: input.asset.symbol, model: modelUsed, language: parsed.language }); }
          catch { data = structuredForecastRead(input, modelUsed); }
        } else {
          let summary = text.replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
          try { summary = String(parseGeminiJson(summary).summary || summary).trim(); } catch { /* Free-form text is expected. */ }
          data = normalizeAiAnalysis({ summary, questions: structuredForecastRead(input, modelUsed).questions }, { symbol: input.asset.symbol, model: modelUsed, language: parsed.language });
        }
        controller.enqueue(sseEvent("done", { data }));
      } catch (cause) {
        controller.enqueue(sseEvent("error", { message: cause instanceof Error ? cause.message : "AI stream failed." }));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { ...PRIVATE_HEADERS, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" } });
}

async function aiAnalysisResponse(request: Request): Promise<Response> {
  if (request.method !== "POST") return privateJson({ error: { code: "method_not_allowed", message: "Method not allowed." } }, 405);
  const { symbol, language, question, conversation } = parseAiRequestBody(await parseBody(request));
  if (!symbol) return privateJson({ error: { code: "validation_error", message: "Symbol is required." } }, 422);
  try {
    const input = await loadAiAnalysisInput(symbol, language, question, conversation);
    const { asset, history, forecast, predictionHistory, performance } = input;
    const freshness = stringHash([
      history.data_as_of,
      forecast.data_as_of,
      forecast.generated_at,
      (predictionHistory?.statistics as Array<Record<string, unknown>> | undefined)?.find((item) => String(item.window) === "All")?.completed,
    ].join("|"));
    const data = await cachedValue(`ai/gemini/v8/${configuredGeminiModel()}/${language}/${asset.symbol}/${freshness}/${stringHash(`${question}|${JSON.stringify(conversation)}`)}`, 6 * 3600, async () => {
      await enforceAiQuota(request);
      return geminiAnalysis(input);
    });
    return privateJson({ data });
  } catch (cause) {
    if (cause instanceof AiRequestError) return privateJson({ error: { code: cause.code, message: cause.message } }, cause.status);
    const detail = cause instanceof Error ? cause.message : "";
    console.error("AI analysis failed", detail);
    const message = detail && detail.length < 220
      ? detail
      : language === "zh"
        ? "AI 解读暂时不可用。"
        : "AI analysis is temporarily unavailable.";
    return privateJson({ error: { code: "ai_analysis_unavailable", message } }, 502);
  }
}

function staticData(group: "forecasts" | "performance" | "history", symbol: string): unknown {
  return (publicData[group] as Record<string, unknown>)[symbol.toUpperCase()];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function forecastKey(symbol: string): string {
  return `forecasts/v11/${symbol.toUpperCase().replace(/[^A-Z0-9.^=-]/g, "_")}.json`;
}

function cloudLedgerKey(symbol: string): string {
  return `ledger/${symbol.toUpperCase().replace(/[^A-Z0-9.^=-]/g, "_")}.json`;
}

function officialKronosKey(symbol: string): string {
  return `kronos/official/v1/${symbol.toUpperCase().replace(/[^A-Z0-9.^=-]/g, "_")}.json`;
}

function modelGovernanceKey(symbol: string): string {
  return `governance/v1/${symbol.toUpperCase().replace(/[^A-Z0-9.^=-]/g, "_")}.json`;
}

function decodeBase64UrlBytes(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function githubOidcAuthorized(request: Request): Promise<boolean> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || token.split(".").length !== 3) return false;
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    const header = JSON.parse(new TextDecoder().decode(decodeBase64UrlBytes(encodedHeader))) as { kid?: string; alg?: string };
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64UrlBytes(encodedPayload))) as Record<string, unknown>;
    const audience = payload.aud;
    const validAudience = audience === GITHUB_OIDC_AUDIENCE || (Array.isArray(audience) && audience.includes(GITHUB_OIDC_AUDIENCE));
    const workflowRef = String(payload.workflow_ref || payload.job_workflow_ref || "");
    if (header.alg !== "RS256"
      || payload.iss !== "https://token.actions.githubusercontent.com"
      || payload.repository !== GITHUB_OIDC_REPOSITORY
      || !validAudience
      || !workflowRef.includes(`${GITHUB_OIDC_REPOSITORY}/.github/workflows/kronos-daily.yml@`)
      || Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) return false;
    const jwks = await cachedValue("auth/github-oidc-jwks-v1", 6 * 3600, async () => {
      const response = await fetch("https://token.actions.githubusercontent.com/.well-known/jwks", { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error(`GitHub OIDC JWKS returned ${response.status}.`);
      return response.json() as Promise<{ keys: Array<Record<string, unknown>> }>;
    }) as { keys: Array<Record<string, unknown>> };
    const jwk = jwks.keys.find((item) => item.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64UrlBytes(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    );
  } catch {
    return false;
  }
}

async function optimizerOrGithubAuthorized(request: Request): Promise<boolean> {
  const token = (process.env.ORIVANE_OPTIMIZER_TOKEN || "").trim();
  if (token && request.headers.get("authorization") === `Bearer ${token}`) return true;
  return githubOidcAuthorized(request);
}

function normalizeOfficialKronosForecast(value: unknown): OfficialKronosForecast | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const symbol = String(item.symbol || "").trim().toUpperCase();
  const dataAsOf = String(item.data_as_of || "").slice(0, 10);
  const generatedAt = String(item.generated_at || "");
  const numericFields = ["base_price", "forecast_1d_return", "forecast_5d_return", "forecast_10d_return", "forecast_1m_return", "lookback", "prediction_length", "sample_count"];
  if (item.schema_version !== KRONOS_SCHEMA_VERSION || item.source !== "official_kronos"
    || !/^[A-Z0-9.^=-]+(?:\.[A-Z]{2,4})?$/.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(dataAsOf)
    || !generatedAt || numericFields.some((field) => !Number.isFinite(Number(item[field])))) return null;
  const limits: Array<[string, number]> = [["forecast_1d_return", 0.2], ["forecast_5d_return", 0.45], ["forecast_10d_return", 0.65], ["forecast_1m_return", 0.9]];
  if (limits.some(([field, limit]) => Math.abs(Number(item[field])) > limit)) return null;
  return {
    schema_version: KRONOS_SCHEMA_VERSION,
    source: "official_kronos",
    symbol,
    model_id: String(item.model_id || "NeoQuasar/Kronos-mini"),
    tokenizer_id: String(item.tokenizer_id || "NeoQuasar/Kronos-Tokenizer-2k"),
    generated_at: generatedAt,
    data_as_of: dataAsOf,
    base_price: Number(item.base_price),
    lookback: Number(item.lookback),
    prediction_length: Number(item.prediction_length),
    sample_count: Number(item.sample_count),
    forecast_1d_return: Number(item.forecast_1d_return),
    forecast_5d_return: Number(item.forecast_5d_return),
    forecast_10d_return: Number(item.forecast_10d_return),
    forecast_1m_return: Number(item.forecast_1m_return),
    forecast_path: Array.isArray(item.forecast_path) ? (item.forecast_path as Array<Record<string, number | string>>).slice(0, 32) : undefined,
  };
}

async function readOfficialKronos(symbol: string, dataAsOf?: string): Promise<OfficialKronosForecast | null> {
  const store = getStore({ name: "orivane-cloud-forecasts", consistency: "strong" });
  const item = normalizeOfficialKronosForecast(await store.get(officialKronosKey(symbol), { type: "json" }));
  if (!item || (dataAsOf && item.data_as_of !== dataAsOf.slice(0, 10))) return null;
  return item;
}

async function writeOfficialKronosBatch(values: unknown[]): Promise<{ accepted: number; rejected: number; symbols: string[] }> {
  const store = getStore({ name: "orivane-cloud-forecasts", consistency: "strong" });
  const normalized = values.map(normalizeOfficialKronosForecast).filter((item): item is OfficialKronosForecast => Boolean(item));
  await Promise.all(normalized.map((item) => store.setJSON(officialKronosKey(item.symbol), item)));
  return { accepted: normalized.length, rejected: values.length - normalized.length, symbols: normalized.map((item) => item.symbol) };
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function directionFromReturn(value: number): "Up" | "Down" {
  return value >= 0 ? "Up" : "Down";
}

const EVALUATION_HORIZONS = [
  { label: "1D", days: 1 },
  { label: "5D", days: 5 },
  { label: "10D", days: 10 },
  { label: "1M", days: 22 },
] as const;

function forecastField(label: string): string {
  return `Forecast_${label}_Return`;
}

function actualField(label: string): string {
  return `Actual_${label}_Return`;
}

function directionField(label: string): string {
  return `Actual_${label}_Direction`;
}

function correctField(label: string): string {
  return label === "1D" ? "Raw_Direction_Correct" : `Direction_Correct_${label}`;
}

function errorField(label: string): string {
  return label === "1D" ? "Absolute_Return_Error" : `Absolute_Return_Error_${label}`;
}

function attachActualOutcomes(row: Record<string, unknown>, currentPrice: number, future: HistoryRecord[]): Record<string, unknown> {
  const updated = { ...row };
  for (const horizon of EVALUATION_HORIZONS) {
    if (future.length < horizon.days || !Number.isFinite(currentPrice) || currentPrice <= 0) continue;
    const target = future[horizon.days - 1];
    const actualPrice = Number(target.Price);
    const forecastReturn = toNumber(updated[forecastField(horizon.label)]);
    if (!Number.isFinite(actualPrice) || forecastReturn === null) continue;
    const actualReturn = actualPrice / currentPrice - 1;
    const actualDirection = directionFromReturn(actualReturn);
    const predictedDirection = directionFromReturn(forecastReturn);
    updated[`Actual_${horizon.label}_Date`] = String(target.Date);
    updated[actualField(horizon.label)] = actualReturn;
    updated[directionField(horizon.label)] = actualDirection;
    updated[correctField(horizon.label)] = predictedDirection === actualDirection ? 1 : 0;
    updated[errorField(horizon.label)] = Math.abs(actualReturn - forecastReturn);
    const kronosReturn = toNumber(updated[`Kronos_Forecast_${horizon.label}_Return`]);
    if (kronosReturn !== null) {
      updated[`Kronos_Direction_Correct_${horizon.label}`] = directionFromReturn(kronosReturn) === actualDirection ? 1 : 0;
      updated[`Kronos_Absolute_Return_Error_${horizon.label}`] = Math.abs(actualReturn - kronosReturn);
    }
    if (horizon.label === "1D" && ["Up", "Down"].includes(String(updated.Action_Signal))) {
      updated.Action_Signal_Correct = String(updated.Action_Signal) === actualDirection ? 1 : 0;
    }
  }
  updated.Verified = toNumber(updated.Actual_1D_Return) !== null;
  return updated;
}

function horizonStatistics(ordered: Array<Record<string, unknown>>, horizon: string, window: number | null): Record<string, unknown> {
  const completedAll = [...ordered]
    .filter((row) => toNumber(row[actualField(horizon)]) !== null && toNumber(row[correctField(horizon)]) !== null)
    .sort((left, right) => String(left.As_Of_Date).localeCompare(String(right.As_Of_Date)));
  const completed = window === null ? completedAll : completedAll.slice(-window);
  const actualDirections = completed.map((row) => String(row[directionField(horizon)])).filter((value) => value === "Up" || value === "Down");
  const upRate = actualDirections.length ? actualDirections.filter((value) => value === "Up").length / actualDirections.length * 100 : null;
  const baseline = upRate === null ? null : Math.max(upRate, 100 - upRate);
  const correct = completed.map((row) => toNumber(row[correctField(horizon)])).filter((value): value is number => value !== null);
  const accuracy = correct.length ? correct.reduce((sum, value) => sum + value, 0) / correct.length * 100 : null;
  const errors = completed.map((row) => toNumber(row[errorField(horizon)])).filter((value): value is number => value !== null);
  return {
    horizon,
    window: window === null ? "All" : String(window),
    completed: completed.length,
    pending: ordered.filter((row) => toNumber(row[actualField(horizon)]) === null).length,
    direction_accuracy: accuracy,
    majority_baseline_accuracy: baseline,
    direction_edge: accuracy !== null && baseline !== null ? accuracy - baseline : null,
    mean_absolute_return_error: errors.length ? mean(errors) : null,
    median_absolute_return_error: errors.length ? [...errors].sort((a, b) => a - b)[Math.floor(errors.length / 2)] : null,
    hit_count: correct.filter((value) => value === 1).length,
    miss_count: correct.filter((value) => value === 0).length,
  };
}

function empiricalForecastInterval(
  rows: Array<Record<string, unknown>>,
  horizon: ForecastInterval["horizon"],
  forecastReturn: number,
  latestPrice: number,
  dailyVolatility: number,
  confidenceLevel = 0.9,
): ForecastInterval {
  const errors = rows
    .map((row) => {
      const actual = toNumber(row[actualField(horizon)]);
      const forecast = toNumber(row[forecastField(horizon)]);
      return actual === null || forecast === null ? null : Math.abs(actual - forecast);
    })
    .filter((value): value is number => value !== null)
    .slice(-180);
  const days = EVALUATION_HORIZONS.find((item) => item.label === horizon)?.days || 1;
  const splitIndex = errors.length >= 60 ? Math.floor(errors.length * 0.7) : errors.length;
  const calibrationErrors = errors.slice(0, splitIndex);
  const validationErrors = errors.slice(splitIndex);
  const empiricalWidth = calibrationErrors.length >= 30 ? quantile(calibrationErrors, confidenceLevel) : null;
  const fallbackWidth = Math.max(0.005, dailyVolatility * Math.sqrt(days) * 1.65);
  const width = empiricalWidth ?? fallbackWidth;
  const returnLow = clamp(forecastReturn - width, -0.85, 0.95);
  const returnHigh = clamp(forecastReturn + width, -0.85, 1.25);
  const covered = validationErrors.length >= 20 && empiricalWidth !== null
    ? validationErrors.filter((errorValue) => errorValue <= empiricalWidth).length / validationErrors.length * 100
    : null;
  return {
    horizon,
    confidence_level: confidenceLevel,
    method: empiricalWidth === null ? "volatility_fallback" : validationErrors.length >= 20 ? "split_conformal" : "empirical_conformal",
    calibration_samples: calibrationErrors.length,
    validation_samples: validationErrors.length,
    empirical_coverage: covered,
    return_low: returnLow,
    return_high: returnHigh,
    price_low: latestPrice * (1 + returnLow),
    price_high: latestPrice * (1 + returnHigh),
  };
}

async function readCloudLedger(symbol: string): Promise<Array<Record<string, unknown>>> {
  const store = getStore({ name: "orivane-cloud-forecasts", consistency: "strong" });
  return await store.get(cloudLedgerKey(symbol), { type: "json" }) as Array<Record<string, unknown>> | null || [];
}

async function writeCloudLedger(symbol: string, records: Array<Record<string, unknown>>): Promise<void> {
  const store = getStore({ name: "orivane-cloud-forecasts", consistency: "strong" });
  await store.setJSON(cloudLedgerKey(symbol), records);
}

async function recordCloudForecast(symbol: string, forecast: Record<string, unknown>): Promise<void> {
  const ticker = String(forecast.symbol || symbol).toUpperCase();
  const asOfDate = String(forecast.data_as_of || "").slice(0, 10);
  if (!asOfDate) return;
  const records = await readCloudLedger(ticker);
  if (records.some((row) => String(row.Ticker).toUpperCase() === ticker && String(row.As_Of_Date).slice(0, 10) === asOfDate)) return;
  const components = Array.isArray(forecast.model_components) ? forecast.model_components as Array<Record<string, unknown>> : [];
  const kronos = components.find((item) => String(item.model) === "Kronos-mini (Official)");
  records.push({
    Created_At: String(forecast.generated_at || new Date().toISOString()),
    As_Of_Date: asOfDate,
    Ticker: ticker,
    Best_Model: String(forecast.best_model || "Cloud Trend"),
    Raw_Direction: String(forecast.forecast_1d_direction || directionFromReturn(Number(forecast.forecast_1d_return || 0))),
    Action_Signal: String(forecast.signal || "Observe"),
    Signal_Quality: String(forecast.signal_quality || "Low"),
    Forecast_1D_Return: forecast.forecast_1d_return,
    Forecast_1D_Price: forecast.forecast_1d_price,
    Forecast_5D_Return: forecast.forecast_5d_return,
    Forecast_5D_Price: forecast.forecast_5d_price,
    Forecast_10D_Return: forecast.forecast_10d_return,
    Forecast_10D_Price: forecast.forecast_10d_price,
    Forecast_1M_Return: forecast.forecast_1m_return,
    Forecast_1M_Price: forecast.forecast_1m_price,
    Confidence_Score: forecast.confidence_score,
    Agreement_Ratio: (forecast.score_components as Record<string, unknown> | undefined)?.agreement_ratio,
    Model_Components: forecast.model_components,
    Calibration: forecast.calibration,
    Model_Governance: forecast.model_governance,
    Kronos_Model: kronos ? String((forecast.official_kronos as Record<string, unknown> | undefined)?.model_id || "NeoQuasar/Kronos-mini") : null,
    Kronos_Forecast_1D_Return: kronos?.forecast_1d_return ?? null,
    Kronos_Forecast_5D_Return: kronos?.forecast_5d_return ?? null,
    Kronos_Forecast_10D_Return: kronos?.forecast_10d_return ?? null,
    Kronos_Forecast_1M_Return: kronos?.forecast_1m_return ?? null,
  });
  records.sort((left, right) => String(right.As_Of_Date).localeCompare(String(left.As_Of_Date)));
  await writeCloudLedger(ticker, records.slice(0, 260));
}

async function reconcileCloudLedger(symbol: string, records: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  if (!records.length) return records;
  const asset = await resolveAsset(symbol);
  const earliest = records.map((row) => String(row.As_Of_Date).slice(0, 10)).filter(Boolean).sort()[0];
  const startDate = new Date(`${earliest || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  startDate.setDate(startDate.getDate() - 10);
  const history = await cachedPublicHistory(asset.symbol, startDate.toISOString().slice(0, 10), asset.data_source, asset.asset_type) as { records: HistoryRecord[] };
  const marketRows = history.records
    .filter((row) => typeof row.Date === "string" && Number.isFinite(Number(row.Price)))
    .sort((left, right) => String(left.Date).localeCompare(String(right.Date)));
  let changed = false;
  const next = records.map((row) => {
    const asOfDate = String(row.As_Of_Date).slice(0, 10);
    const past = marketRows.filter((item) => String(item.Date) <= asOfDate);
    const future = marketRows.filter((item) => String(item.Date) > asOfDate);
    if (!past.length) return row;
    const currentPrice = Number(past.at(-1)?.Price);
    const updated = attachActualOutcomes(row, currentPrice, future);
    if (JSON.stringify(updated) !== JSON.stringify(row)) changed = true;
    return updated;
  });
  if (changed) await writeCloudLedger(symbol, next);
  return next;
}

async function readModelGovernance(symbol: string): Promise<ModelGovernance | null> {
  const store = getStore({ name: "orivane-cloud-forecasts", consistency: "strong" });
  return await store.get(modelGovernanceKey(symbol), { type: "json" }) as ModelGovernance | null;
}

function evaluateModelGovernance(symbol: string, records: Array<Record<string, unknown>>, previous: ModelGovernance | null): ModelGovernance {
  const stats20 = horizonStatistics(records, "1D", 20);
  const stats60 = horizonStatistics(records, "1D", 60);
  const statsAll = horizonStatistics(records, "1D", null);
  const samples20 = Number(stats20.completed || 0);
  const samplesAll = Number(statsAll.completed || 0);
  const edge20 = toNumber(stats20.direction_edge);
  const edgeAll = toNumber(statsAll.direction_edge);
  const accuracy20 = toNumber(stats20.direction_accuracy);
  const accuracy60 = toNumber(stats60.direction_accuracy);
  const accuracyDrop = accuracy20 !== null && accuracy60 !== null ? accuracy60 - accuracy20 : 0;
  const driftScore = samples20 < 20 ? 0 : clamp(
    Math.max(0, -(edge20 ?? 0)) * 5 + Math.max(0, accuracyDrop - 3) * 3 + Math.max(0, -(edgeAll ?? 0)) * 2,
    0,
    100,
  );
  let status: ModelGovernance["status"] = "warming_up";
  if (samples20 >= 20) {
    status = (edge20 !== null && edge20 <= -3) || (accuracyDrop >= 10 && Number(edge20 ?? -1) <= 0)
      ? "rollback"
      : (edge20 !== null && edge20 < 1) || accuracyDrop >= 6
        ? "watch"
        : "stable";
  }
  if (previous?.status === "rollback" && status === "watch" && Number(edge20 ?? 0) < 3) status = "rollback";
  const activeModel = status === "rollback" ? "Orivane Ensemble Safe Mode" : "Orivane Horizon Router";
  const reasons = status === "warming_up"
    ? [`真实冻结样本 ${samplesAll} 个，达到 20 个后启用漂移与回滚判断。`, `Only ${samplesAll} frozen live samples are complete; drift checks activate at 20.`]
    : status === "rollback"
      ? [`近 20 个真实样本方向优势 ${edge20?.toFixed(1) ?? "—"} 个百分点，已回退到未调权组合并暂停未验证叠加信号。`, `The latest 20-sample edge is ${edge20?.toFixed(1) ?? "—"} points; the router rolled back to the untuned ensemble and paused unvalidated overlays.`]
      : status === "watch"
        ? [`近 20 个样本优势 ${edge20?.toFixed(1) ?? "—"} 个百分点，进入观察状态，候选模型不再自动晋级。`, `The latest 20-sample edge is ${edge20?.toFixed(1) ?? "—"} points; challengers are blocked while the model is under watch.`]
        : [`近 20 个样本方向优势 ${edge20?.toFixed(1) ?? "—"} 个百分点，模型运行稳定。`, `The latest 20-sample edge is ${edge20?.toFixed(1) ?? "—"} points and the model is stable.`];
  return {
    symbol: symbol.toUpperCase(),
    version: MODEL_GOVERNANCE_VERSION,
    status,
    active_model: activeModel,
    evaluated_at: new Date().toISOString(),
    live_samples_20: samples20,
    live_samples_all: samplesAll,
    direction_edge_20: edge20,
    direction_edge_all: edgeAll,
    accuracy_20: accuracy20,
    accuracy_60: accuracy60,
    drift_score: Number(driftScore.toFixed(2)),
    rollback_count: Number(previous?.rollback_count || 0) + (status === "rollback" && previous?.status !== "rollback" ? 1 : 0),
    reason_zh: reasons[0],
    reason_en: reasons[1],
  };
}

async function persistModelGovernance(symbol: string, records: Array<Record<string, unknown>>): Promise<ModelGovernance> {
  const store = getStore({ name: "orivane-cloud-forecasts", consistency: "strong" });
  const previous = await readModelGovernance(symbol).catch(() => null);
  const governance = evaluateModelGovernance(symbol, records, previous);
  await store.setJSON(modelGovernanceKey(symbol), governance);
  return governance;
}

async function settleForecastSymbols(symbols: string[]): Promise<Record<string, unknown>> {
  const unique = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))].slice(0, 100);
  const settled = await settleWithConcurrency(unique, 4, async (symbol) => {
    const records = await readCloudLedger(symbol);
    const reconciled = await reconcileCloudLedger(symbol, records);
    const governance = await persistModelGovernance(symbol, reconciled);
    return { symbol, records: reconciled.length, completed: Number(horizonStatistics(reconciled, "1D", null).completed || 0), governance };
  });
  return {
    requested: unique.length,
    succeeded: settled.filter((item) => item.status === "fulfilled").length,
    failed: settled.filter((item) => item.status === "rejected").length,
    finished_at: new Date().toISOString(),
    results: settled.map((item, index) => item.status === "fulfilled" ? item.value : { symbol: unique[index], error: item.reason instanceof Error ? item.reason.message : "settlement_failed" }),
  };
}

function buildLedgerHistory(symbol: string, records: Array<Record<string, unknown>>): Record<string, unknown> {
  const ordered = [...records].sort((left, right) => String(right.As_Of_Date).localeCompare(String(left.As_Of_Date)));
  const completedAll = [...ordered]
    .filter((row) => toNumber(row.Actual_1D_Return) !== null && toNumber(row.Raw_Direction_Correct) !== null)
    .sort((left, right) => String(left.As_Of_Date).localeCompare(String(right.As_Of_Date)));
  const statistics = [20, 60, 120, null].map((window) => horizonStatistics(ordered, "1D", window));
  const horizonStatisticsRows = EVALUATION_HORIZONS.flatMap((horizon) => [20, 60, 120, null].map((window) => horizonStatistics(ordered, horizon.label, window)));
  let hits = 0;
  const rolling = completedAll.map((row, index) => {
    hits += Number(row.Raw_Direction_Correct || 0);
    const recent = completedAll.slice(Math.max(0, index - 19), index + 1);
    const recentHits = recent.reduce((sum, item) => sum + Number(item.Raw_Direction_Correct || 0), 0);
    return {
      As_Of_Date: row.As_Of_Date,
      Rolling_Accuracy_20: recent.length ? recentHits / recent.length * 100 : null,
      Cumulative_Accuracy: (index + 1) ? hits / (index + 1) * 100 : null,
    };
  });
  return {
    symbol,
    notice: "Historical accuracy uses completed frozen predictions only.",
    statistics,
    horizon_statistics: horizonStatisticsRows,
    records: ordered.map((row) => ({
      ...row,
      Verified: toNumber(row.Actual_1D_Return) !== null,
      Verified_5D: toNumber(row.Actual_5D_Return) !== null,
      Verified_10D: toNumber(row.Actual_10D_Return) !== null,
      Verified_1M: toNumber(row.Actual_1M_Return) !== null,
    })),
    charts: { rolling_accuracy: rolling, scatter: [], timeline: [], errors: [] },
  };
}

function emptyLedgerHistory(symbol: string, notice: string): Record<string, unknown> {
  return {
    symbol,
    notice,
    statistics: [20, 60, 120, null].map((window) => ({
      horizon: "1D",
      window: window === null ? "All" : String(window),
      completed: 0,
      pending: 0,
      direction_accuracy: null,
      majority_baseline_accuracy: null,
      direction_edge: null,
      mean_absolute_return_error: null,
      median_absolute_return_error: null,
      hit_count: 0,
      miss_count: 0,
    })),
    horizon_statistics: [],
    records: [],
    charts: { rolling_accuracy: [], scatter: [], timeline: [], errors: [] },
  };
}

function segmentedPredictionHistory(
  symbol: string,
  backtest: Record<string, unknown> | null,
  live: Record<string, unknown> | null,
  legacy: Record<string, unknown> | null,
): Record<string, unknown> {
  const backtestData = backtest || emptyLedgerHistory(symbol, "No walk-forward backtest is available yet.");
  const liveData = live || emptyLedgerHistory(symbol, "No completed frozen live predictions are available yet.");
  const legacyData = legacy || emptyLedgerHistory(symbol, "No legacy prediction records are available.");
  return {
    symbol,
    notice: "Walk-forward backtests, frozen live predictions and legacy records are reported separately.",
    statistics: liveData.statistics,
    records: liveData.records,
    charts: liveData.charts,
    backtest: backtestData,
    live: liveData,
    legacy: legacyData,
  };
}

const WALK_FORWARD_SAMPLE_LIMIT = 120;

interface WalkForwardEvaluation {
  predictions: Array<Record<string, unknown>>;
  models: Array<Record<string, unknown>>;
}

function walkForwardEvaluationRows(
  symbol: string,
  history: { records: HistoryRecord[] },
  sampleLimit = WALK_FORWARD_SAMPLE_LIMIT,
): WalkForwardEvaluation {
  const rows = history.records
    .filter((row) => typeof row.Date === "string" && Number.isFinite(Number(row.Price)))
    .sort((left, right) => String(left.Date).localeCompare(String(right.Date)));
  const predictions: Array<Record<string, unknown>> = [];
  const models: Array<Record<string, unknown>> = [];
  const firstIndex = Math.max(60, rows.length - sampleLimit - 1);
  for (let index = firstIndex; index < rows.length - 1; index += 1) {
    const past = rows.slice(0, index + 1);
    const current = rows[index];
    const future = rows.slice(index + 1);
    const currentPrice = Number(current.Price);
    const rollingStd = Number(current.Rolling_Std_20);
    try {
      const trend = trendForecast({
        snapshot: {
          latest_price: currentPrice,
          annualized_volatility_20d: Number.isFinite(rollingStd) ? rollingStd * Math.sqrt(252) : null,
        },
        records: past,
      });
      const row = attachActualOutcomes({
        Created_At: new Date(`${String(current.Date)}T00:00:00Z`).toISOString(),
        As_Of_Date: String(current.Date),
        Ticker: symbol.toUpperCase(),
        Best_Model: "Orivane Ensemble",
        Raw_Direction: trend.direction,
        Action_Signal: trend.signal,
        Signal_Quality: trend.quality,
        Forecast_1D_Return: trend.forecast1d,
        Forecast_1D_Price: currentPrice * (1 + trend.forecast1d),
        Forecast_5D_Return: trend.forecast5d,
        Forecast_5D_Price: currentPrice * (1 + trend.forecast5d),
        Forecast_10D_Return: trend.forecast10d,
        Forecast_10D_Price: currentPrice * (1 + trend.forecast10d),
        Forecast_1M_Return: trend.forecast1m,
        Forecast_1M_Price: currentPrice * (1 + trend.forecast1m),
        Confidence_Score: trend.confidenceScore,
        Agreement_Ratio: trend.agreementRatio,
        Model_Components: trend.modelComponents.map((component) => ({
          model: component.model,
          weight: component.weight,
          forecast_1d_return: component.forecast1d,
          forecast_5d_return: component.forecast5d,
        })),
        Backtest: true,
      }, currentPrice, future);
      predictions.push(row);
      const candidates = [
        { model: "Orivane Ensemble", forecast1d: trend.forecast1d, forecast5d: trend.forecast5d, forecast10d: trend.forecast10d, forecast1m: trend.forecast1m },
        ...trend.modelComponents,
        { model: "Naive No Change", forecast1d: 0, forecast5d: 0, forecast10d: 0, forecast1m: 0 },
      ];
      candidates.forEach((candidate) => {
        models.push(attachActualOutcomes({
          Created_At: new Date(`${String(current.Date)}T00:00:00Z`).toISOString(),
          As_Of_Date: String(current.Date),
          Ticker: symbol.toUpperCase(),
          Best_Model: candidate.model,
          Base_Price: currentPrice,
          Raw_Direction: directionFromReturn(candidate.forecast1d),
          Action_Signal: Math.abs(candidate.forecast1d) < 0.0001 ? "Observe" : directionFromReturn(candidate.forecast1d),
          Signal_Quality: candidate.model === "Orivane Ensemble" ? trend.quality : "Medium",
          Forecast_1D_Return: candidate.forecast1d,
          Forecast_1D_Price: currentPrice * (1 + candidate.forecast1d),
          Forecast_5D_Return: candidate.forecast5d,
          Forecast_5D_Price: currentPrice * (1 + candidate.forecast5d),
          Forecast_10D_Return: candidate.forecast10d,
          Forecast_10D_Price: currentPrice * (1 + candidate.forecast10d),
          Forecast_1M_Return: candidate.forecast1m,
          Forecast_1M_Price: currentPrice * (1 + candidate.forecast1m),
          Confidence_Score: candidate.model === "Orivane Ensemble" ? trend.confidenceScore : null,
          Backtest: true,
        }, currentPrice, future));
      });
    } catch {
      // Skip days where the rolling model does not have enough valid inputs.
    }
  }
  return { predictions, models };
}

function walkForwardPredictionRows(symbol: string, history: { records: HistoryRecord[] }): Array<Record<string, unknown>> {
  return walkForwardEvaluationRows(symbol, history).predictions;
}

function summarizeModelRows(model: string, rows: Array<Record<string, unknown>>): Record<string, unknown> {
  const completed = rows.filter((row) => String(row.Best_Model) === model && toNumber(row.Actual_1D_Return) !== null && toNumber(row.Forecast_1D_Return) !== null);
  const actualReturns = completed.map((row) => toNumber(row.Actual_1D_Return)).filter((value): value is number => value !== null);
  const forecastReturns = completed.map((row) => toNumber(row.Forecast_1D_Return)).filter((value): value is number => value !== null);
  const returnErrors = completed.map((row) => Math.abs(Number(row.Actual_1D_Return || 0) - Number(row.Forecast_1D_Return || 0))).filter(Number.isFinite);
  const correct = completed.map((row) => toNumber(row.Raw_Direction_Correct)).filter((value): value is number => value !== null);
  const upRate = actualReturns.length ? actualReturns.filter((value) => value >= 0).length / actualReturns.length * 100 : null;
  const baseline = upRate === null ? null : Math.max(upRate, 100 - upRate);
  const accuracy = correct.length ? correct.reduce((sum, value) => sum + value, 0) / correct.length * 100 : null;
  const averageActual = mean(actualReturns) || 0;
  const ssTotal = actualReturns.reduce((sum, value) => sum + (value - averageActual) ** 2, 0);
  const ssResidual = actualReturns.reduce((sum, value, index) => sum + (value - (forecastReturns[index] || 0)) ** 2, 0);
  const priceErrors = completed.map((row) => {
    const base = Number(row.Base_Price || (Number(row.Forecast_1D_Price) / (1 + Number(row.Forecast_1D_Return || 0))));
    if (!Number.isFinite(base) || base <= 0) return null;
    return base * (1 + Number(row.Forecast_1D_Return || 0)) - base * (1 + Number(row.Actual_1D_Return || 0));
  }).filter((value): value is number => value !== null && Number.isFinite(value));
  const returnRmse = returnErrors.length ? Math.sqrt(returnErrors.reduce((sum, value) => sum + value ** 2, 0) / returnErrors.length) : null;
  return {
    Model: model,
    MAE: priceErrors.length ? mean(priceErrors.map(Math.abs)) : null,
    RMSE: priceErrors.length ? Math.sqrt(priceErrors.reduce((sum, value) => sum + value ** 2, 0) / priceErrors.length) : null,
    Return_MAE_Pct_Points: returnErrors.length ? mean(returnErrors)! * 100 : null,
    R2: ssTotal > 0 ? 1 - ssResidual / ssTotal : null,
    Return_MAE: returnErrors.length ? mean(returnErrors) : null,
    Return_RMSE: returnRmse,
    Directional_Accuracy: accuracy,
    Majority_Baseline_Accuracy: baseline,
    Directional_Edge: accuracy !== null && baseline !== null ? accuracy - baseline : null,
    Samples: completed.length,
  };
}

function summarizeModelHorizon(model: string, rows: Array<Record<string, unknown>>, horizon: ForecastHorizon): Record<string, number | string | null> {
  const completed = rows.filter((row) => String(row.Best_Model) === model
    && toNumber(row[actualField(horizon)]) !== null
    && toNumber(row[forecastField(horizon)]) !== null
    && toNumber(row[correctField(horizon)]) !== null);
  const actual = completed.map((row) => Number(row[actualField(horizon)]));
  const forecast = completed.map((row) => Number(row[forecastField(horizon)]));
  const correct = completed.map((row) => Number(row[correctField(horizon)]));
  const accuracy = correct.length ? mean(correct)! * 100 : null;
  const upRate = actual.length ? actual.filter((value) => value >= 0).length / actual.length * 100 : null;
  const baseline = upRate === null ? null : Math.max(upRate, 100 - upRate);
  const errors = actual.map((value, index) => value - forecast[index]);
  return {
    model,
    samples: completed.length,
    direction_accuracy: accuracy,
    majority_baseline_accuracy: baseline,
    direction_edge: accuracy !== null && baseline !== null ? accuracy - baseline : null,
    return_rmse: errors.length ? Math.sqrt(mean(errors.map((value) => value ** 2)) || 0) : null,
  };
}

function horizonModelSelections(trend: TrendForecast, modelRows: Array<Record<string, unknown>>): HorizonModelSelection[] {
  const horizonFields: Record<ForecastHorizon, keyof Pick<ForecastComponent, "forecast1d" | "forecast5d" | "forecast10d" | "forecast1m">> = {
    "1D": "forecast1d",
    "5D": "forecast5d",
    "10D": "forecast10d",
    "1M": "forecast1m",
  };
  const ensembleReturns: Record<ForecastHorizon, number> = {
    "1D": trend.forecast1d,
    "5D": trend.forecast5d,
    "10D": trend.forecast10d,
    "1M": trend.forecast1m,
  };
  const modelNames = ["Orivane Ensemble", ...trend.modelComponents.map((component) => component.model)];
  return EVALUATION_HORIZONS.map(({ label }) => {
    const horizon = label as ForecastHorizon;
    const completedDates = [...new Set(modelRows
      .filter((row) => toNumber(row[actualField(horizon)]) !== null)
      .map((row) => String(row.As_Of_Date || ""))
      .filter(Boolean))].sort();
    const holdoutSize = Math.max(20, Math.floor(completedDates.length * 0.3));
    const cutoff = completedDates[Math.max(0, completedDates.length - holdoutSize)] || "";
    const holdoutRows = cutoff ? modelRows.filter((row) => String(row.As_Of_Date || "") >= cutoff) : [];
    const summaries = modelNames.map((model) => summarizeModelHorizon(model, holdoutRows, horizon));
    const ensemble = summaries.find((item) => item.model === "Orivane Ensemble")!;
    const eligible = summaries.filter((item) => Number(item.samples || 0) >= 20
      && Number(item.direction_edge ?? -100) >= 1
      && Number(item.direction_accuracy ?? 0) >= 50)
      .sort((left, right) => Number(right.direction_edge ?? -100) - Number(left.direction_edge ?? -100)
        || Number(left.return_rmse ?? 1) - Number(right.return_rmse ?? 1));
    const challenger = eligible[0];
    const promote = Boolean(challenger
      && challenger.model !== "Orivane Ensemble"
      && (Number(challenger.direction_accuracy || 0) >= Number(ensemble.direction_accuracy || 0) + 1
        || Number(ensemble.direction_edge ?? -100) <= 0));
    const selected = promote ? challenger : ensemble;
    const component = trend.modelComponents.find((item) => item.model === selected.model);
    const forecastReturn = component ? Number(component[horizonFields[horizon]]) : ensembleReturns[horizon];
    const direction = directionFromReturn(forecastReturn);
    const similar = holdoutRows.filter((row) => String(row.Best_Model) === selected.model
      && toNumber(row[actualField(horizon)]) !== null
      && toNumber(row[forecastField(horizon)]) !== null
      && directionFromReturn(Number(row[forecastField(horizon)])) === direction);
    const hits = similar.reduce((sum, row) => sum + Number(row[correctField(horizon)] || 0), 0);
    const probability = similar.length >= 12 ? (hits + 6) / (similar.length + 12) * 100 : null;
    const reasonZh = promote
      ? `${String(selected.model)} 在独立留出段优于组合基线，已用于该周期。`
      : `候选模型未同时通过样本、基准优势和留出验证，保留组合模型。`;
    const reasonEn = promote
      ? `${String(selected.model)} beat the ensemble on the independent holdout and is routed to this horizon.`
      : "No challenger passed sample, baseline-edge and holdout gates; the ensemble remains active.";
    return {
      horizon,
      selected_model: String(selected.model || "Orivane Ensemble"),
      forecast_return: forecastReturn,
      direction,
      direction_probability: probability,
      probability_samples: similar.length,
      validation_samples: Number(selected.samples || 0),
      direction_accuracy: toNumber(selected.direction_accuracy),
      majority_baseline_accuracy: toNumber(selected.majority_baseline_accuracy),
      direction_edge: toNumber(selected.direction_edge),
      return_rmse: toNumber(selected.return_rmse),
      promoted: promote,
      reason_zh: reasonZh,
      reason_en: reasonEn,
    };
  });
}

function predictionHistoryFromBacktest(symbol: string, history: { records: HistoryRecord[] }): Record<string, unknown> {
  return buildLedgerHistory(symbol, walkForwardPredictionRows(symbol, history));
}

function modelPerformanceFromHistory(symbol: string, history: { records: HistoryRecord[] }, liveHistory: Record<string, unknown> | null): Record<string, unknown> {
  const evaluation = walkForwardEvaluationRows(symbol, history);
  const rows = evaluation.predictions;
  const modelRows = evaluation.models;
  const modelNames = [...new Set(modelRows.map((row) => String(row.Best_Model)).filter(Boolean))];
  const models = modelNames.map((model) => summarizeModelRows(model, modelRows))
    .sort((left, right) => {
      const leftEdge = toNumber(left.Directional_Edge) ?? -100;
      const rightEdge = toNumber(right.Directional_Edge) ?? -100;
      if (rightEdge !== leftEdge) return rightEdge - leftEdge;
      return (toNumber(left.Return_RMSE) ?? 1) - (toNumber(right.Return_RMSE) ?? 1);
    });
  const best = models.find((item) => String(item.Model) === "Orivane Ensemble") || models[0] || summarizeModelRows("Orivane Ensemble", rows);
  const ledger = buildLedgerHistory(symbol, rows);
  const liveStats = Array.isArray(liveHistory?.statistics)
    ? liveHistory.statistics
    : (emptyLedgerHistory(symbol, "No frozen live predictions are available yet.").statistics as unknown[]);
  return {
    symbol,
    best_model: String(best.Model || "Orivane Ensemble"),
    backtest: {
      best,
      models,
      test_samples: rows.length,
      evaluation_start: rows.at(0)?.As_Of_Date || null,
      evaluation_end: rows.at(-1)?.As_Of_Date || null,
      horizon_statistics: ledger.horizon_statistics,
    },
    live_predictions: {
      statistics: liveStats,
      notice: "模型表现优先显示历史走步回测；真实线上预测会随每日冻结结果继续校准。",
    },
  };
}

function confidenceBucket(score: number | null): string {
  if (score === null) return "unknown";
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function calibrateForecast(trend: TrendForecast, rows: Array<Record<string, unknown>>): ForecastCalibration {
  const completed = rows
    .filter((row) => toNumber(row.Actual_1D_Return) !== null && toNumber(row.Forecast_1D_Return) !== null)
    .sort((left, right) => String(left.As_Of_Date).localeCompare(String(right.As_Of_Date)));
  const bucket = confidenceBucket(trend.confidenceScore);
  const sameDirection = completed.filter((row) => directionFromReturn(Number(row.Forecast_1D_Return || 0)) === trend.direction);
  const sameBucket = sameDirection.filter((row) => confidenceBucket(toNumber(row.Confidence_Score)) === bucket);
  const sample = (sameBucket.length >= 8 ? sameBucket : sameDirection).slice(-80);
  const correct = sample.map((row) => toNumber(row.Raw_Direction_Correct)).filter((value): value is number => value !== null);
  const averageFor = (field: string) => {
    const values = sample.map((row) => toNumber(row[field])).filter((value): value is number => value !== null);
    return values.length ? mean(values) : null;
  };
  const hitRate = correct.length ? correct.reduce((sum, value) => sum + value, 0) / correct.length * 100 : null;
  const noteZh = sample.length >= 20
    ? `找到 ${sample.length} 个历史相似信号，方向命中率 ${hitRate === null ? "—" : `${hitRate.toFixed(1)}%`}。`
    : sample.length
      ? `相似信号样本只有 ${sample.length} 个，结果可参考但权重应降低。`
      : "尚无可用相似信号样本，先以模型组合和后续验证为主。";
  const noteEn = sample.length >= 20
    ? `Found ${sample.length} similar historical signals with a ${hitRate === null ? "—" : `${hitRate.toFixed(1)}%`} direction hit rate.`
    : sample.length
      ? `Only ${sample.length} similar signals are available, so use the result with lower weight.`
      : "No similar-signal sample is available yet; rely on the ensemble and future validation.";
  return {
    sample_size: sample.length,
    total_samples: completed.length,
    confidence_bucket: bucket,
    direction_hit_rate: hitRate,
    average_1d_return: averageFor("Actual_1D_Return"),
    average_5d_return: averageFor("Actual_5D_Return"),
    average_10d_return: averageFor("Actual_10D_Return"),
    average_1m_return: averageFor("Actual_1M_Return"),
    note_zh: noteZh,
    note_en: noteEn,
  };
}

async function cloudLedgerHistory(symbol: string): Promise<Record<string, unknown> | null> {
  const records = await readCloudLedger(symbol);
  if (!records.length) return null;
  const reconciled = await reconcileCloudLedger(symbol, records);
  return buildLedgerHistory(symbol, reconciled);
}

function applyCurrentForecastGuard(forecast: Record<string, unknown>): Record<string, unknown> {
  const horizonModels = Array.isArray(forecast.horizon_models) ? forecast.horizon_models as Array<Record<string, unknown>> : [];
  const month = horizonModels.find((item) => String(item.horizon) === "1M");
  const validation = forecast.validation && typeof forecast.validation === "object" ? forecast.validation as Record<string, unknown> : {};
  const backtest = validation.backtest && typeof validation.backtest === "object" ? validation.backtest as Record<string, unknown> : {};
  const live = validation.live && typeof validation.live === "object" ? validation.live as Record<string, unknown> : {};
  const calibration = forecast.calibration && typeof forecast.calibration === "object" ? forecast.calibration as Record<string, unknown> : {};
  const rawLevels = forecast.key_levels && typeof forecast.key_levels === "object" ? forecast.key_levels as Record<string, unknown> : {};
  const keyLevels: ForecastKeyLevels = {
    support: toNumber(rawLevels.support),
    resistance: toNumber(rawLevels.resistance),
    stop_loss: toNumber(rawLevels.stop_loss),
    breakout: toNumber(rawLevels.breakout),
    invalidation: toNumber(rawLevels.invalidation),
    invalidation_zh: String(rawLevels.invalidation_zh || ""),
    invalidation_en: String(rawLevels.invalidation_en || ""),
  };
  const action = buildForecastAction(
    toNumber(forecast.forecast_1m_return) || 0,
    toNumber(forecast.confidence_score) || 0,
    keyLevels,
    {
      backtest_samples: Number(month?.validation_samples ?? backtest.samples ?? 0),
      backtest_edge: toNumber(month?.direction_edge ?? backtest.direction_edge),
      calibration_samples: Number(month?.probability_samples ?? calibration.sample_size ?? 0),
      calibration_hit_rate: toNumber(month?.direction_probability ?? calibration.direction_hit_rate),
      live_samples: Number(live.samples || 0),
      live_edge: toNumber(live.direction_edge),
      fresh: true,
    },
  );
  const routedSignalValue = (toNumber(forecast.forecast_1d_return) || 0) * 0.25
    + (toNumber(forecast.forecast_5d_return) || 0) * 0.28
    + (toNumber(forecast.forecast_10d_return) || 0) * 0.2
    + (toNumber(forecast.forecast_1m_return) || 0) * 0.27;
  return {
    ...forecast,
    signal: action.actionable ? (routedSignalValue >= 0 ? "Up" : "Down") : "Observe",
    action,
    validation: {
      ...validation,
      actionability: {
        actionable: action.actionable,
        evidence_status: action.evidence_status,
        minimum_backtest_samples: 60,
        minimum_similar_samples: 20,
        minimum_direction_edge: 2,
        minimum_similar_hit_rate: 52,
        live_guard_minimum_samples: 20,
        live_guard_requires_positive_edge: true,
      },
    },
  };
}

async function readFrozenCloudForecast(symbol: string, expectedDataAsOf?: string | null): Promise<Record<string, unknown> | null> {
  const memory = MEMORY_FORECASTS.get(symbol.toUpperCase()) || null;
  const store = getStore({ name: "orivane-cloud-forecasts", consistency: "strong" });
  const stored = await store.get(forecastKey(symbol), { type: "json" }).catch(() => null) as Record<string, unknown> | null;
  const cached = memory || stored;
  const generatedAt = typeof cached?.generated_at === "string" ? new Date(cached.generated_at).getTime() : 0;
  if (!cached || !generatedAt || Date.now() - generatedAt > FORECAST_CACHE_MAX_AGE_MS) return null;
  let marketDate = expectedDataAsOf ? String(expectedDataAsOf).slice(0, 10) : "";
  if (!marketDate) {
    try {
      const asset = await resolveAsset(symbol);
      const start = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
      const history = await cachedPublicHistory(asset.symbol, start, asset.data_source, asset.asset_type) as { data_as_of?: string };
      marketDate = String(history.data_as_of || "").slice(0, 10);
    } catch {
      return null;
    }
  }
  if (!marketDate || String(cached.data_as_of || "").slice(0, 10) !== marketDate) return null;
  await recordCloudForecast(symbol, cached).catch(() => undefined);
  return applyCurrentForecastGuard(cached);
}

async function freezeCloudForecast(symbol: string, forecast: Record<string, unknown>): Promise<Record<string, unknown>> {
  rememberForecast(symbol, forecast);
  const store = getStore({ name: "orivane-cloud-forecasts", consistency: "strong" });
  await store.setJSON(forecastKey(symbol), forecast).catch(() => undefined);
  await recordCloudForecast(symbol, forecast).catch(() => undefined);
  return forecast;
}

function benchmarkForAsset(asset: Asset): Asset {
  if (asset.symbol.endsWith(".HK")) return { symbol: "^HSI", name: "Hang Seng Index", asset_type: "index", exchange: "HKEX", currency: "HKD", data_source: "yahoo" };
  if (asset.symbol.endsWith(".SH") || asset.symbol.endsWith(".SZ")) return { symbol: "000300.SS", name: "CSI 300 Index", asset_type: "index", exchange: "SSE", currency: "CNY", data_source: "yahoo" };
  if ((SECTORS[asset.symbol] || "").includes("Technology") || asset.exchange === "NASDAQ") return { symbol: "QQQ", name: "Invesco QQQ Trust", asset_type: "etf", exchange: "NASDAQ", currency: "USD", data_source: "yahoo" };
  return { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", asset_type: "etf", exchange: "NYSE Arca", currency: "USD", data_source: "yahoo" };
}

async function benchmarkContextForAsset(asset: Asset, start: string): Promise<ForecastContext | undefined> {
  const benchmark = benchmarkForAsset(asset);
  try {
    const history = await cachedPublicHistory(benchmark.symbol, start, benchmark.data_source, benchmark.asset_type) as { records: HistoryRecord[] };
    const prices = history.records.map((row) => Number(row.Price)).filter(Number.isFinite);
    if (prices.length < 25) return undefined;
    const latest = prices.at(-1)!;
    return {
      benchmark_symbol: benchmark.symbol,
      benchmark_name: benchmark.name,
      benchmark_return_5d: prices.length > 5 ? latest / prices[prices.length - 6] - 1 : null,
      benchmark_return_20d: prices.length > 20 ? latest / prices[prices.length - 21] - 1 : null,
    };
  } catch {
    return undefined;
  }
}

async function optimizationForForecast(asset: Asset, dataAsOf: string | null | undefined, modelRows: Array<Record<string, unknown>>): Promise<ForecastOptimization> {
  return historyOptimizationProfile(asset.symbol, modelRows, dataAsOf);
}

async function cloudTrendForecast(symbol: string, optimize = true): Promise<Record<string, unknown>> {
  const asset = await resolveAsset(symbol);
  const start = new Date(Date.now() - 900 * 86400000).toISOString().slice(0, 10);
  const [history, benchmarkContext] = await Promise.all([
    cachedPublicHistory(asset.symbol, start, asset.data_source, asset.asset_type) as Promise<{
      data_as_of: string;
      snapshot: { latest_price: number; annualized_volatility_20d?: number | null };
      records: HistoryRecord[];
    }>,
    benchmarkContextForAsset(asset, start),
  ]);
  const latestPrice = Number(history.snapshot.latest_price);
  const liveHistory = await cloudLedgerHistory(asset.symbol).catch(() => null);
  const liveRecords = Array.isArray(liveHistory?.records) ? liveHistory.records as Array<Record<string, unknown>> : [];
  const modelGovernance = await persistModelGovernance(asset.symbol, liveRecords).catch(() => evaluateModelGovernance(asset.symbol, liveRecords, null));
  const safeMode = modelGovernance.status === "rollback";
  const dailyVolatility = Number(history.snapshot.annualized_volatility_20d || 0) / Math.sqrt(252) || 0.012;
  const [officialKronos, contextualSignal] = safeMode
    ? [null, null]
    : await Promise.all([
      readOfficialKronos(asset.symbol, history.data_as_of).catch(() => null),
      optimize ? contextualForecastSignal(asset, dailyVolatility).catch(() => null) : Promise.resolve(null),
    ]);
  const context: ForecastContext = { ...(benchmarkContext || {}), official_kronos: officialKronos, contextual_signal: contextualSignal };
  const evaluation = walkForwardEvaluationRows(asset.symbol, history);
  const backtestRows = evaluation.predictions;
  const modelRows = evaluation.models;
  const optimization = optimize && !safeMode
    ? await optimizationForForecast(asset, history.data_as_of, modelRows).catch(() => historyOptimizationProfile(asset.symbol, modelRows, history.data_as_of))
    : neutralForecastOptimization(history.data_as_of, safeMode ? "真实冻结样本触发漂移回滚，暂停自动调权与未验证叠加信号。" : "核心资产每日冻结仅使用已验证基准权重；昂贵调权仅对收藏资产运行。");
  const trend = trendForecast({ ...history, context, optimization });
  let horizonModels = horizonModelSelections(trend, modelRows);
  if (modelGovernance.status === "watch" || modelGovernance.status === "rollback") {
    const ensembleReturns: Record<ForecastHorizon, number> = { "1D": trend.forecast1d, "5D": trend.forecast5d, "10D": trend.forecast10d, "1M": trend.forecast1m };
    horizonModels = horizonModels.map((item) => ({
      ...item,
      selected_model: modelGovernance.active_model,
      forecast_return: ensembleReturns[item.horizon],
      direction: directionFromReturn(ensembleReturns[item.horizon]),
      promoted: false,
      reason_zh: modelGovernance.reason_zh,
      reason_en: modelGovernance.reason_en,
    }));
  }
  const routed = Object.fromEntries(horizonModels.map((item) => [item.horizon, item.forecast_return])) as Record<ForecastHorizon, number>;
  const routedForecastDays = buildForecastPath(latestPrice, { d1: routed["1D"], d5: routed["5D"], d10: routed["10D"], d22: routed["1M"] });
  const calibration = calibrateForecast(trend, backtestRows);
  const ensemblePerformance = summarizeModelRows("Orivane Ensemble", modelRows);
  const optimizerHoldout = optimization.active && optimization.diagnostics?.holdout && typeof optimization.diagnostics.holdout === "object"
    ? optimization.diagnostics.holdout as Record<string, unknown>
    : null;
  const backtestSamples = optimizerHoldout ? Number(optimizerHoldout.samples || 0) : Number(ensemblePerformance.Samples || 0);
  const backtestAccuracy = optimizerHoldout ? toNumber(optimizerHoldout.accuracy) : toNumber(ensemblePerformance.Directional_Accuracy);
  const backtestBaseline = optimizerHoldout ? toNumber(optimizerHoldout.baseline) : toNumber(ensemblePerformance.Majority_Baseline_Accuracy);
  const backtestEdge = optimizerHoldout ? toNumber(optimizerHoldout.edge) : toNumber(ensemblePerformance.Directional_Edge);
  const liveAll = Array.isArray(liveHistory?.statistics)
    ? (liveHistory.statistics as Array<Record<string, unknown>>).find((item) => String(item.window) === "All")
    : null;
  const liveSamples = Number(liveAll?.completed || 0);
  const intervals: ForecastInterval[] = [
    empiricalForecastInterval(backtestRows, "1D", routed["1D"], latestPrice, trend.marketRegime.daily_volatility),
    empiricalForecastInterval(backtestRows, "5D", routed["5D"], latestPrice, trend.marketRegime.daily_volatility),
    empiricalForecastInterval(backtestRows, "10D", routed["10D"], latestPrice, trend.marketRegime.daily_volatility),
    empiricalForecastInterval(backtestRows, "1M", routed["1M"], latestPrice, trend.marketRegime.daily_volatility),
  ];
  const holdoutCoverages = intervals.map((item) => item.empirical_coverage).filter((value): value is number => value !== null);
  const intervalCoverage = mean(holdoutCoverages);
  const coverageLift = intervalCoverage === null ? -3 : intervalCoverage < 80 ? -8 : intervalCoverage < 85 ? -5 : intervalCoverage < 88 ? -2 : 0;
  const calibrationLift = calibration.sample_size >= 20 && calibration.direction_hit_rate !== null
    ? calibration.direction_hit_rate >= 56
      ? 5
      : calibration.direction_hit_rate < 48
        ? -6
        : 0
    : 0;
  const calibratedProbabilities = horizonModels.map((item) => item.direction_probability).filter((value): value is number => value !== null);
  const routingLift = calibratedProbabilities.length ? clamp(((mean(calibratedProbabilities) || 50) - 50) * 0.35, -7, 7) : -2;
  const edgeLift = backtestEdge === null ? -8 : clamp(backtestEdge * 0.75, -18, 9);
  const governanceLift = modelGovernance.status === "rollback" ? -12 : modelGovernance.status === "watch" ? -6 : 0;
  const eventLift = contextualSignal?.earnings_risk ? -3 : 0;
  const confidenceScore = Math.round(clamp(trend.confidenceScore + calibrationLift + edgeLift + coverageLift + routingLift + governanceLift + eventLift, 0, 100));
  const actionHorizon = horizonModels.find((item) => item.horizon === "1M")!;
  const action = buildForecastAction(routed["1M"], confidenceScore, trend.keyLevels, {
    backtest_samples: actionHorizon.validation_samples,
    backtest_edge: actionHorizon.direction_edge,
    calibration_samples: actionHorizon.probability_samples,
    calibration_hit_rate: actionHorizon.direction_probability,
    live_samples: liveSamples,
    live_edge: toNumber(liveAll?.direction_edge),
    fresh: true,
  });
  const monthInterval = intervals.find((item) => item.horizon === "1M")!;
  const expectedRange1m: ForecastExpectedRange = {
    low: monthInterval.price_low,
    high: monthInterval.price_high,
    return_low: monthInterval.return_low,
    return_high: monthInterval.return_high,
  };
  const validation = {
    backtest: {
      method: optimizerHoldout ? "walk_forward_tuned_holdout" : "walk_forward_baseline",
      samples: backtestSamples,
      direction_accuracy: backtestAccuracy,
      majority_baseline_accuracy: backtestBaseline,
      direction_edge: backtestEdge,
      return_mae: toNumber(ensemblePerformance.Return_MAE),
      return_rmse: toNumber(ensemblePerformance.Return_RMSE),
    },
    live: {
      samples: liveSamples,
      direction_accuracy: toNumber(liveAll?.direction_accuracy),
      majority_baseline_accuracy: toNumber(liveAll?.majority_baseline_accuracy),
      direction_edge: toNumber(liveAll?.direction_edge),
    },
    actionability: {
      actionable: action.actionable,
      evidence_status: action.evidence_status,
      minimum_backtest_samples: 60,
      minimum_similar_samples: 20,
      minimum_direction_edge: 2,
      minimum_similar_hit_rate: 52,
      live_guard_minimum_samples: 20,
      live_guard_requires_positive_edge: true,
    },
    horizons: Object.fromEntries(horizonModels.map((item) => {
      const liveStats = Array.isArray(liveHistory?.horizon_statistics)
        ? (liveHistory.horizon_statistics as Array<Record<string, unknown>>).find((row) => String(row.horizon) === item.horizon && String(row.window) === "All")
        : null;
      return [item.horizon, {
        ...item,
        live_samples: Number(liveStats?.completed || 0),
        live_direction_accuracy: toNumber(liveStats?.direction_accuracy),
        live_majority_baseline_accuracy: toNumber(liveStats?.majority_baseline_accuracy),
        live_direction_edge: toNumber(liveStats?.direction_edge),
      }];
    })),
  };
  const routedSignalValue = routed["1D"] * 0.25 + routed["5D"] * 0.28 + routed["10D"] * 0.2 + routed["1M"] * 0.27;
  const routedSignal = action.actionable ? (routedSignalValue >= 0 ? "Up" : "Down") : "Observe";
  const routedScenarios = buildForecastScenarios(latestPrice, routed["1M"], trend.marketRegime.daily_volatility, trend.agreementRatio);
  const routingSummaryZh = horizonModels.map((item) => `${item.horizon} ${item.selected_model}${item.direction_probability === null ? "" : `（${item.direction_probability.toFixed(1)}%）`}`).join("；");
  const routingSummaryEn = horizonModels.map((item) => `${item.horizon} ${item.selected_model}${item.direction_probability === null ? "" : ` (${item.direction_probability.toFixed(1)}%)`}`).join("; ");
  return {
    symbol: asset.symbol,
    best_model: modelGovernance.active_model,
    base_price: latestPrice,
    signal: routedSignal,
    signal_quality: trend.quality,
    forecast_1d_return: routed["1D"],
    forecast_1d_price: latestPrice * (1 + routed["1D"]),
    forecast_1d_direction: directionFromReturn(routed["1D"]),
    forecast_5d_return: routed["5D"],
    forecast_5d_price: latestPrice * (1 + routed["5D"]),
    forecast_10d_return: routed["10D"],
    forecast_10d_price: latestPrice * (1 + routed["10D"]),
    forecast_1m_return: routed["1M"],
    forecast_1m_price: latestPrice * (1 + routed["1M"]),
    forecast_days: routedForecastDays,
    forecast_volatility_1m: trend.forecastVolatility1m,
    expected_range_1m: expectedRange1m,
    forecast_intervals: intervals,
    kline_forecast: trend.klineForecast,
    risk: null,
    generated_at: new Date().toISOString(),
    data_as_of: history.data_as_of,
    validation_sample_size: backtestSamples,
    beats_majority_baseline: backtestEdge === null ? null : backtestEdge > 0,
    confidence_score: confidenceScore,
    calibration,
    horizon_models: horizonModels,
    horizon_calibration: Object.fromEntries(horizonModels.map((item) => [item.horizon, {
      direction_probability: item.direction_probability,
      sample_size: item.probability_samples,
      validation_samples: item.validation_samples,
      direction_accuracy: item.direction_accuracy,
      majority_baseline_accuracy: item.majority_baseline_accuracy,
      direction_edge: item.direction_edge,
      calibrated: item.probability_samples >= 20,
    }])),
    validation,
    model_governance: modelGovernance,
    official_kronos: officialKronos ? {
      source: officialKronos.source,
      model_id: officialKronos.model_id,
      tokenizer_id: officialKronos.tokenizer_id,
      generated_at: officialKronos.generated_at,
      data_as_of: officialKronos.data_as_of,
      lookback: officialKronos.lookback,
      prediction_length: officialKronos.prediction_length,
      sample_count: officialKronos.sample_count,
      forecast_path: officialKronos.forecast_path,
    } : null,
    contextual_inputs: contextualSignal ? {
      inputs: contextualSignal.inputs,
      score: contextualSignal.score,
      fundamental_score: contextualSignal.fundamental_score,
      news_score: contextualSignal.news_score,
      earnings_risk: contextualSignal.earnings_risk,
      earnings_date: contextualSignal.earnings_date,
      earnings_days: contextualSignal.earnings_days,
      overlay_weight: CONTEXTUAL_SIGNAL_WEIGHT,
      forecast_adjustment: {
        "1D": contextualSignal.forecasts.d1 * CONTEXTUAL_SIGNAL_WEIGHT,
        "5D": contextualSignal.forecasts.d5 * CONTEXTUAL_SIGNAL_WEIGHT,
        "10D": contextualSignal.forecasts.d10 * CONTEXTUAL_SIGNAL_WEIGHT,
        "1M": contextualSignal.forecasts.d22 * CONTEXTUAL_SIGNAL_WEIGHT,
      },
      drivers_zh: contextualSignal.drivers_zh,
      drivers_en: contextualSignal.drivers_en,
    } : null,
    model_components: trend.modelComponents.map((component) => ({
      model: component.model,
      weight: component.weight,
      direction: component.direction,
      forecast_1d_return: component.forecast1d,
      forecast_5d_return: component.forecast5d,
      forecast_10d_return: component.forecast10d,
      forecast_1m_return: component.forecast1m,
      strength: component.strength,
    })),
    score_components: {
      trend_strength: trend.strength,
      signal_quality: trend.quality,
      latest_price: latestPrice,
      agreement_ratio: trend.agreementRatio,
      calibration_sample_size: calibration.sample_size,
      calibration_hit_rate: calibration.direction_hit_rate,
      walk_forward_direction_edge: backtestEdge,
      interval_holdout_coverage: intervalCoverage,
      interval_coverage_lift: coverageLift,
      live_validation_samples: liveSamples,
      actionable: action.actionable ? 1 : 0,
      market_regime: trend.marketRegime.regime,
      benchmark_symbol: trend.marketRegime.benchmark_symbol,
      benchmark_return_5d: trend.marketRegime.benchmark_return_5d,
      self_optimization_active: trend.optimization.active,
      self_optimization_source: trend.optimization.source,
      self_optimization_sample_size: trend.optimization.sample_size,
      self_optimization_weight_shift: trend.optimization.applied_weight_shift || 0,
      kline_sequence_score: trend.klineForecast.score,
      kline_pattern_score: trend.klineForecast.pattern_score,
      kline_volume_score: trend.klineForecast.volume_score,
      kline_range_score: trend.klineForecast.range_score,
      forecast_volatility_1m: trend.forecastVolatility1m,
    },
    market_regime: trend.marketRegime,
    action,
    key_levels: trend.keyLevels,
    scenarios: routedScenarios,
    self_optimization: trend.optimization,
    drivers_zh: [`分周期路由：${routingSummaryZh}。`, modelGovernance.reason_zh, officialKronos ? `已接入官方 ${officialKronos.model_id} 当日批量预测，权重上限 ${(OFFICIAL_KRONOS_WEIGHT * 100).toFixed(0)}%。` : "当前没有与行情日期一致的官方 Kronos 批量结果，未使用旧结果。", ...trend.drivers_zh, calibration.note_zh, `走步验证方向优势 ${backtestEdge === null ? "—" : `${backtestEdge.toFixed(1)} 个百分点`}；${action.actionable ? "已达到操作门槛" : "仅保留方向观察"}。`],
    drivers_en: [`Horizon routing: ${routingSummaryEn}.`, modelGovernance.reason_en, officialKronos ? `The current official ${officialKronos.model_id} batch is active with a maximum ${(OFFICIAL_KRONOS_WEIGHT * 100).toFixed(0)}% weight.` : "No official Kronos batch matches the current market date, so stale output was not used.", ...trend.drivers_en, calibration.note_en, `Walk-forward directional edge is ${backtestEdge === null ? "—" : `${backtestEdge.toFixed(1)} percentage points`}; ${action.actionable ? "the action threshold is met" : "the output remains directional only"}.`],
    explanation: trend.drivers_en,
  };
}

async function generateAndFreezeCloudForecast(symbol: string, optimize = true): Promise<Record<string, unknown>> {
  const forecast = await cloudTrendForecast(symbol, optimize);
  return freezeCloudForecast(String(forecast.symbol || symbol), forecast);
}

async function marketSnapshots(symbols: string[], start: string, view: "full" | "lite", include: "all" | "history" | "forecast"): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  for (let offset = 0; offset < symbols.length; offset += 4) {
    const chunk = symbols.slice(offset, offset + 4);
    const resolved = await Promise.all(chunk.map(async (rawSymbol) => {
      const errors: Array<{ kind: "asset" | "history" | "forecast"; message: string }> = [];
      try {
        const asset = await resolveAsset(rawSymbol);
        const [historyResult, forecastResult] = await Promise.allSettled([
          include === "forecast" ? Promise.resolve(null) : cachedPublicHistory(asset.symbol, start, asset.data_source, asset.asset_type),
          include === "history" ? Promise.resolve(null) : Promise.resolve(readFrozenCloudForecast(asset.symbol)).then((value) => value || generateAndFreezeCloudForecast(asset.symbol, false)),
        ]);
        let history: Record<string, unknown> | null = null;
        let forecast: Record<string, unknown> | null = null;
        if (historyResult.status === "fulfilled" && historyResult.value) history = view === "lite" ? liteHistory(historyResult.value) : historyResult.value;
        else if (historyResult.status === "rejected") errors.push({ kind: "history", message: historyResult.reason instanceof Error ? historyResult.reason.message : "Market data unavailable." });
        if (forecastResult.status === "fulfilled" && forecastResult.value) forecast = forecastResult.value;
        else if (forecastResult.status === "rejected") errors.push({ kind: "forecast", message: forecastResult.reason instanceof Error ? forecastResult.reason.message : "Forecast unavailable." });
        return { asset, ...(history ? { history } : {}), ...(forecast ? { forecast } : {}), errors };
      } catch (cause) {
        return { asset: { symbol: rawSymbol }, errors: [{ kind: "asset", message: cause instanceof Error ? cause.message : "Asset unavailable." }] };
      }
    }));
    results.push(...resolved);
  }
  return results;
}

async function route(request: Request, context: Context): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/(?:api|\.netlify\/functions\/api)/, "") || "/";
  if (request.method === "GET" && path === "/health") {
    return json(await providerHealthSnapshot(context));
  }
  if (request.method === "GET" && path === "/admin/metrics") {
    if (!await requireAdmin(request, context)) return privateJson({ error: { code: "forbidden", message: "Admin access required." } }, 403);
    return privateJson({ data: await metricsSummary() });
  }
  if (path === "/events") return recordProductEvent(request, context);
  if (path.startsWith("/auth/")) return authResponse(request, context);
  if (request.method === "GET" && path === "/assets/logo") return logoResponse(url.searchParams.get("symbol"));
  if (request.method === "GET" && path === "/assets/search") {
    const query = url.searchParams.get("q")?.trim();
    return query ? cachedJson({ query, results: await cachedValue(`search-v4/${aliasKey(query)}`, 6 * 3600, () => searchAssets(query)) }) : error(422, "validation_error", "Search query is required.");
  }
  if (request.method === "GET" && path === "/home") return cachedJson({ data: await cachedValue("market/home-v5", 60 * 60, homeData) });
  if (request.method === "GET" && path === "/forecast/scoreboard") return cachedJson({ data: await cachedValue("forecast/public-scoreboard-v2", 6 * 3600, forecastScoreboard) });
  if (request.method === "GET" && path === "/kronos/latest") {
    const symbol = String(url.searchParams.get("symbol") || "").toUpperCase();
    if (!symbol) return error(422, "validation_error", "Symbol is required.");
    return cachedJson({ data: await readOfficialKronos(symbol) });
  }
  if (request.method === "POST" && path === "/kronos/batch") {
    if (!await optimizerOrGithubAuthorized(request)) return privateJson({ error: { code: "forbidden", message: "Authorized batch runner required." } }, 403);
    const body = await parseBody(request);
    const values = Array.isArray(body.forecasts) ? body.forecasts : [];
    if (!values.length || values.length > 100) return error(422, "validation_error", "Forecasts must contain between 1 and 100 records.");
    return privateJson({ data: await writeOfficialKronosBatch(values) });
  }
  if (request.method === "POST" && path === "/forecast/settle") {
    if (!await optimizerOrGithubAuthorized(request)) return privateJson({ error: { code: "forbidden", message: "Authorized settlement job required." } }, 403);
    const body = await parseBody(request);
    const symbols = Array.isArray(body.symbols) ? body.symbols.map((item) => String(item)) : CATALOG.map((asset) => asset.symbol);
    return privateJson({ data: await settleForecastSymbols(symbols) });
  }
  if (request.method === "GET" && path === "/market/gainers") return cachedJson({ data: await cachedValue("market/gainers", 60 * 60, marketGainers) });
  if (request.method === "GET" && path === "/market/overview") return cachedJson({ data: await cachedValue("market/overview-v3", 60 * 60, marketOverview) });
  if (request.method === "GET" && path === "/screener") return cachedJson({ data: await cachedValue("market/screener-v5", 4 * 3600, async () => (await screenerRows()).map(slimScreenerRow)) });
  if (request.method === "GET" && path === "/recommendations") return cachedJson({ data: await cachedValue("market/recommendations-v6", 4 * 3600, recommendations) });
  if (path === "/ai/analysis/stream") return aiAnalysisStreamResponse(request);
  if (path === "/ai/analysis") return aiAnalysisResponse(request);
  if (request.method === "GET" && path === "/company/research") {
    const symbol = url.searchParams.get("symbol")?.toUpperCase();
    const forcedRegion = url.searchParams.get("news_region")?.toLowerCase();
    const newsRegion: NewsRegion = forcedRegion === "cn" || forcedRegion === "domestic"
      ? "cn"
      : forcedRegion === "global"
        ? "global"
        : context.geo?.country?.code?.toUpperCase() === "CN"
          ? "cn"
          : "global";
    return symbol ? cachedJson({ data: await cachedValue(`company/research/${newsRegion}/${symbol}`, 12 * 3600, () => companyResearch(symbol, newsRegion)) }, GEO_CACHE_HEADERS) : error(422, "validation_error", "Symbol is required.");
  }
  if (path === "/alerts/test") return sendAlertTest(request, context);
  if (path === "/alerts/process") return processAlerts(request, context);
  if (path === "/user/state") return userState(request, context);
  if (request.method === "POST" && path === "/assets/resolve") {
    const symbols = (await parseBody(request)).symbols;
    if (!Array.isArray(symbols)) return error(422, "validation_error", "Symbols must be an array.");
    const resolved = await Promise.all(symbols.map((item) => resolveAsset(String(item))));
    const assets = [...new Map(resolved.map((asset) => [asset.symbol, asset])).values()].slice(0, MAX_COMPARE_ASSETS);
    return json({ assets });
  }
  if (request.method === "GET" && path === "/market/history") {
    const symbol = url.searchParams.get("symbol")?.toUpperCase();
    const source = url.searchParams.get("data_source") || "yahoo";
    const assetType = url.searchParams.get("asset_type") || "market";
    if (!symbol) return error(422, "validation_error", "Symbol is required.");
    try {
      const history = await cachedPublicHistory(symbol, url.searchParams.get("start") || "2025-01-01", source, assetType);
      return cachedJson({ data: url.searchParams.get("view") === "lite" ? liteHistory(history) : history });
    } catch (cause) {
      return error(502, "data_source_error", cause instanceof Error ? cause.message : "Market data unavailable.");
    }
  }
  if (request.method === "GET" && path === "/market/snapshot") {
    const symbols = [...new Set(String(url.searchParams.get("symbols") || "").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean))].slice(0, 20);
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(url.searchParams.get("start") || "")) ? String(url.searchParams.get("start")) : "2025-01-01";
    const view = url.searchParams.get("view") === "full" ? "full" : "lite";
    const requestedInclude = url.searchParams.get("include");
    const include = requestedInclude === "history" || requestedInclude === "forecast" ? requestedInclude : "all";
    if (!symbols.length) return error(422, "validation_error", "At least one symbol is required.");
    const key = `market/snapshot-v1/${include}/${view}/${start}/${symbols.join(",")}`;
    return cachedJson({ data: await cachedValue(key, 15 * 60, () => marketSnapshots(symbols, start, view, include)) });
  }
  if (request.method === "GET" && path === "/market/returns") {
    const symbol = url.searchParams.get("symbol")?.toUpperCase();
    const scope = url.searchParams.get("scope") === "recent" ? "recent" : "full";
    if (!symbol) return error(422, "validation_error", "Symbol is required.");
    try {
      const asset = await resolveAsset(symbol);
      const data = await cachedValue(`market/period-returns-v5/${scope}/${asset.symbol}`, 12 * 3600, async () => {
        const dailyStart = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
        const dailyHistory = await cachedPublicHistory(asset.symbol, dailyStart, asset.data_source, asset.asset_type);
        const dailyReturns = periodReturns(dailyHistory);
        if (scope === "recent") {
          return {
            symbol: asset.symbol,
            data_as_of: dailyHistory.data_as_of,
            long_term_complete: false,
            returns: Object.fromEntries(["1D", "5D", "1M", "6M", "YTD", "1Y"].map((range) => [range, dailyReturns[range]])),
          };
        }
        const maxHistory = await cachedPublicHistory(asset.symbol, "1900-01-01", asset.data_source, asset.asset_type);
        const maxReturns = periodReturns(maxHistory);
        return {
          symbol: asset.symbol,
          data_as_of: dailyHistory.data_as_of,
          long_term_complete: true,
          returns: { ...maxReturns, ...Object.fromEntries(["1D", "5D", "1M", "6M", "YTD", "1Y"].map((range) => [range, dailyReturns[range]])) },
        };
      });
      return cachedJson({ data });
    } catch (cause) {
      return error(502, "data_source_error", cause instanceof Error ? cause.message : "Market data unavailable.");
    }
  }
  if (request.method === "POST" && path === "/compare") {
    const body = await parseBody(request);
    const assets = Array.isArray(body.assets) ? body.assets.slice(0, MAX_COMPARE_ASSETS) as Asset[] : [];
    const settled = await Promise.allSettled(assets.map((asset) => cachedPublicHistory(asset.symbol, String(body.start || "2025-01-01"), asset.data_source, asset.asset_type)));
    const series: unknown[] = [];
    const errors: unknown[] = [];
    settled.forEach((item, index) => {
      if (item.status === "rejected") errors.push({ symbol: assets[index].symbol, message: item.reason instanceof Error ? item.reason.message : "Unavailable" });
      else {
        const history = item.value as { symbol: string; data_as_of: string; data_source: string; records: HistoryRecord[] };
        const first = Number(history.records[0].Price);
        series.push({ symbol: history.symbol, data_as_of: history.data_as_of, data_source: history.data_source, snapshot: (item.value as Record<string, unknown>).snapshot, points: history.records.map((row) => ({ date: row.Date, price: row.Price, normalized: Number(row.Price) / first * 100 })) });
      }
    });
    return json({ data: { series, errors } });
  }
  if (request.method === "GET" && path === "/forecast/latest") {
    const symbol = url.searchParams.get("symbol")?.toUpperCase() || "";
    try {
      return json({ data: await readFrozenCloudForecast(symbol) || await generateAndFreezeCloudForecast(symbol, false) });
    } catch (cause) {
      const data = staticData("forecasts", symbol);
      if (data) return json({ data });
      return error(502, "forecast_unavailable", cause instanceof Error ? cause.message : "Forecast unavailable.");
    }
  }
  const performance = path.match(/^\/performance\/([^/]+)$/);
  if (request.method === "GET" && performance) {
    const symbol = decodeURIComponent(performance[1]).toUpperCase();
    try {
      const asset = await resolveAsset(symbol);
      const start = new Date(Date.now() - 900 * 86400000).toISOString().slice(0, 10);
      const [historyData, liveHistory] = await Promise.all([
        cachedPublicHistory(asset.symbol, start, asset.data_source, asset.asset_type) as Promise<{ records: HistoryRecord[] }>,
        cloudLedgerHistory(asset.symbol).catch(() => null),
      ]);
      const data = await cachedValue(`performance/cloud-v4/${asset.symbol}/${String((historyData.records.at(-1) || {}).Date)}`, 6 * 3600, async () => modelPerformanceFromHistory(asset.symbol, historyData, liveHistory));
      return json({ data });
    } catch (cause) {
      const data = staticData("performance", symbol);
      return data ? json({ data }) : error(502, "forecast_not_found", cause instanceof Error ? cause.message : "暂无该资产的模型表现。");
    }
  }
  const history = path.match(/^\/predictions\/history\/([^/]+)$/);
  if (request.method === "GET" && history) {
    const symbol = decodeURIComponent(history[1]).toUpperCase();
    try {
      const asset = await resolveAsset(symbol);
      const start = new Date(Date.now() - 900 * 86400000).toISOString().slice(0, 10);
      const [historyData, frozenHistory] = await Promise.all([
        cachedPublicHistory(asset.symbol, start, asset.data_source, asset.asset_type) as Promise<{ records: HistoryRecord[] }>,
        cloudLedgerHistory(asset.symbol).catch(() => null),
      ]);
      const backtestHistory = await cachedValue(`predictions/backtest-v4/${asset.symbol}/${String((historyData.records.at(-1) || {}).Date)}`, 6 * 3600, async () => predictionHistoryFromBacktest(asset.symbol, historyData)) as Record<string, unknown>;
      const legacyHistory = staticData("history", asset.symbol) as Record<string, unknown> | null;
      const data = segmentedPredictionHistory(asset.symbol, backtestHistory, frozenHistory, legacyHistory);
      return json({ data });
    } catch (cause) {
      const frozenHistory = await cloudLedgerHistory(symbol).catch(() => null);
      const data = segmentedPredictionHistory(symbol, null, frozenHistory, staticData("history", symbol) as Record<string, unknown> | null);
      return json({ data });
    }
  }
  if (request.method === "POST" && path === "/forecast/run") {
    const jobToken = (process.env.ORIVANE_OPTIMIZER_TOKEN || "").trim();
    const authorizedJob = Boolean(jobToken && request.headers.get("authorization") === `Bearer ${jobToken}`);
    const signedInUser = authorizedJob ? null : await currentUser(request, context).catch(() => null);
    if (!authorizedJob && !signedInUser) return privateJson({ error: { code: "unauthorized", message: "Sign in is required to refresh a forecast." } }, 401);
    const body = await parseBody(request);
    const symbol = String(body.symbol || "").toUpperCase();
    if (!symbol) return error(422, "validation_error", "Symbol is required.");
    try {
      return json({ data: await generateAndFreezeCloudForecast(symbol, authorizedJob ? body.optimize !== false : true) });
    } catch (cause) {
      return error(502, "forecast_unavailable", cause instanceof Error ? cause.message : "Forecast unavailable.");
    }
  }
  if (request.method === "GET" && path.startsWith("/forecast/status/")) return error(404, "forecast_task_not_found", "当前云端预测为同步生成，无需等待后台任务。");
  return error(404, "not_found", "Endpoint not found.");
}

export default async (request: Request, context: Context): Promise<Response> => {
  const started = Date.now();
  const url = new URL(request.url);
  const metricPath = `${request.method} ${url.pathname.replace(/^\/(?:api|\.netlify\/functions\/api)/, "") || "/"}`;
  try {
    const response = await route(request, context);
    if (shouldRecordRequestMetric(metricPath, response.status) && (response.status >= 500 || Math.random() < METRIC_SAMPLE_RATE)) {
      context.waitUntil(recordRequestMetric(metricPath, response.status, Date.now() - started));
    }
    return response;
  } catch (cause) {
    const response = error(500, "internal_error", cause instanceof Error ? cause.message : "Unexpected error.");
    if (shouldRecordRequestMetric(metricPath, response.status)) context.waitUntil(recordRequestMetric(metricPath, response.status, Date.now() - started));
    return response;
  }
};

export const config: Config = { path: "/api/*" };
