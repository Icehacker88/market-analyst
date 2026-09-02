export type Asset = {
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

export type Gainer = Asset & {
  return_1y: number | null;
  data_as_of?: string;
};

export type HistoryRecord = {
  Date: string;
  Price: number;
  Open?: number | null;
  High?: number | null;
  Low?: number | null;
  Close?: number | null;
  Volume?: number | null;
  Daily_Return?: number | null;
  Weekly_Return?: number | null;
  Cumulative_Return?: number | null;
  MA_5?: number | null;
  MA_20?: number | null;
  MA_50?: number | null;
  RSI_14?: number | null;
  MACD?: number | null;
  MACD_Signal?: number | null;
  MACD_Hist?: number | null;
  BB_Upper?: number | null;
  BB_Lower?: number | null;
  Rolling_Std_20?: number | null;
};

export type ScreenerRow = Gainer & {
  sector: string;
  latest_price: number | null;
  return_1d: number | null;
  return_3m: number | null;
  volatility_20d: number | null;
  market_cap: number | null;
  pe_ratio: number | null;
  signal: Forecast["signal"];
  confidence: number | null;
  forecast_1d_return?: number | null;
  forecast_5d_return?: number | null;
  forecast_10d_return?: number | null;
  forecast_1m_return?: number | null;
  prediction_confidence_score?: number | null;
  market_regime?: Forecast["market_regime"];
  action?: Forecast["action"];
  key_levels?: Forecast["key_levels"];
  scenarios?: Forecast["scenarios"];
  recommendation_score?: number | null;
  recommendation_reason_zh?: string | null;
  recommendation_reason_en?: string | null;
  recommendation_risk_zh?: string | null;
  recommendation_risk_en?: string | null;
  recommendation_style_zh?: string | null;
  recommendation_style_en?: string | null;
  recommendation_horizon_zh?: string | null;
  recommendation_horizon_en?: string | null;
  recommendation_tags_zh?: string[];
  recommendation_tags_en?: string[];
};

export type CompanyResearch = {
  asset: Asset;
  sector: string;
  data_as_of: string | null;
  market: Record<string, number | string | null>;
  fundamentals: Record<string, number | null>;
  next_earnings_date?: string | null;
  next_earnings_date_source?: string | null;
  summary_zh?: string;
  summary_en?: string;
  strengths_zh?: string[];
  strengths_en?: string[];
  risks_zh?: string[];
  risks_en?: string[];
  news_region?: "cn" | "global";
  news: Array<{ title: string; publisher: string; link: string; published_at: string | null; thumbnail?: string | null }>;
};

export type MarketOverview = {
  gainers: ScreenerRow[];
  losers: ScreenerRow[];
  forecast_movers: ScreenerRow[];
  forecast_bullish?: ScreenerRow[];
  forecast_bearish?: ScreenerRow[];
  risk_watch?: ScreenerRow[];
  data_as_of: string | null;
};

export type HomeData = {
  gainers: Gainer[];
  overview: MarketOverview;
  scoreboard?: {
    scope: string;
    symbols: string[];
    data_as_of: string | null;
    generated_at: string;
    backtest: { statistics: LedgerStat[]; horizon_statistics: LedgerStat[] };
    live: { statistics: LedgerStat[]; horizon_statistics: LedgerStat[] };
    methodology?: Record<string, boolean | string>;
    per_asset?: ForecastScoreAsset[];
  };
};

export type ForecastGovernance = {
  status: "warming_up" | "stable" | "watch" | "rollback";
  active_model: string;
  evaluated_at: string;
  live_samples_20: number;
  live_samples_all: number;
  direction_edge_20: number | null;
  direction_edge_all: number | null;
  drift_score: number;
  rollback_count: number;
  reason_zh: string;
  reason_en: string;
};

export type ForecastScoreAsset = {
  symbol: string;
  data_as_of: string | null;
  backtest: { statistics: LedgerStat[]; horizon_statistics: LedgerStat[] };
  live: { statistics: LedgerStat[]; horizon_statistics: LedgerStat[] };
  governance?: ForecastGovernance | null;
  kronos?: { model_id: string; data_as_of: string; generated_at: string } | null;
};

export type ForecastScoreboard = NonNullable<HomeData["scoreboard"]> & {
  methodology: Record<string, boolean | string>;
  per_asset: ForecastScoreAsset[];
  monitored_symbols?: string[];
  recent_live_records?: Record<string, number | string | boolean | null>[];
};

export type RecommendationGroup = {
  id: "a_shares" | "us_stocks" | "hk_stocks";
  title_zh: string;
  title_en: string;
  summary_zh: string;
  summary_en: string;
  data_as_of: string | null;
  rows: ScreenerRow[];
};

export type Recommendations = {
  data_as_of: string | null;
  groups: RecommendationGroup[];
};

export type AiAnalysis = {
  symbol: string;
  provider: "gemini";
  model: string;
  generated_at: string;
  language: "zh" | "en";
  source?: "gemini" | "structured_fallback";
  fallback_reason?: string | null;
  summary: string;
  forecast_read: string[];
  confidence_notes: string[];
  risks: string[];
  watch_items: string[];
  questions?: string[];
};

export type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  analysis?: AiAnalysis;
};

export type AiChatThread = {
  messages: AiChatMessage[];
  summary?: string;
  updated_at: string;
};

export type Watchlist = { id: string; name: string; symbols: string[] };
export type PriceAlert = { id: string; symbol: string; type: "above" | "below" | "change" | "signal" | "confidence" | "invalidation"; value: number | string; enabled: boolean };
export type AlertHistory = {
  id: string;
  symbol: string;
  type: PriceAlert["type"];
  value: number | string;
  price: number;
  change: number;
  triggered_at: string;
  read_at?: string | null;
  deep_link?: string;
  title?: string;
  body?: string;
};
export type PortfolioHolding = { symbol: string; quantity: number; cost: number };
export type Portfolio = { id: string; name: string; currency: string; holdings: PortfolioHolding[] };
export type SavedScreener = { id: string; name: string; filters: Record<string, string | number> };
export type DecisionProfile = {
  status: "holding" | "watching";
  entry_price?: number | null;
  horizon: "5D" | "10D" | "1M";
  risk: "conservative" | "balanced" | "aggressive";
};
export type ResearchReview = {
  symbol: string;
  reason: "next_session" | "breakout" | "pullback" | "invalidation";
  due_at: string;
  created_at: string;
  reference_price?: number | null;
  trigger_price?: number | null;
  data_as_of?: string | null;
};
export type NotificationPreferences = {
  email_enabled: boolean;
  browser_enabled: boolean;
  daily_digest: boolean;
  quiet_hours_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  timezone: string;
  min_interval_minutes: number;
};
export type UserState = {
  watchlists: Watchlist[];
  alerts: PriceAlert[];
  alert_history?: AlertHistory[];
  portfolios: Portfolio[];
  savedScreeners: SavedScreener[];
  state_revision?: number;
  updated_at?: string | null;
  account_email?: string;
  preferred_language?: "zh" | "en";
  daily_summary_enabled?: boolean;
  notification_preferences?: NotificationPreferences;
  last_notified?: Record<string, string>;
  last_notified_at?: Record<string, string>;
  forecast_snapshots?: Record<string, { signal: string; confidence: number | null; invalidation: number | null; data_as_of: string; price?: number | null }>;
  decision_profiles?: Record<string, DecisionProfile>;
  research_reviews?: Record<string, ResearchReview>;
  research_preferences?: {
    market: "global" | "us" | "a" | "hk";
    goal: "opportunity" | "risk" | "learn";
    updated_at?: string;
  };
  ai_chats?: Record<string, AiChatThread>;
  portfolio_ai_chat?: AiChatThread;
};

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
  pictureUrl?: string | null;
  confirmedAt?: string;
};

export type AuthSession = {
  token?: string;
  user: AuthUser;
};

export type MetricsSummary = {
  provider: string;
  paid_provider_ready: boolean;
  metric_sample_rate?: number;
  favorite_optimizer?: {
    run_date: string;
    trigger: string;
    started_at: string;
    finished_at: string;
    site_url: string;
    total_users: number;
    total_symbols: number;
    processed_symbols: number;
    succeeded: number;
    failed: number;
    skipped: boolean;
    partition?: "first" | "second" | "manual";
    core_symbols?: number;
    favorite_symbols?: number;
    prewarm_job?: { status: "ok" | "partial"; succeeded: number; failed: number };
    alert_job?: { status: "ok" | "error"; message?: string };
    symbols: Array<{ symbol: string; status: "ok" | "error"; message?: string }>;
  } | null;
  date: string;
  updated_at: string;
  requests: Record<string, { count: number; errors: number; total_ms: number; statuses: Record<string, number>; latency_samples?: number[]; p50_ms?: number | null; p75_ms?: number | null; p95_ms?: number | null }>;
  cache: Record<string, { hit: number; miss: number; stale: number; error: number }>;
  events?: Record<string, number>;
  web_vitals?: Record<string, { count: number; total: number; samples: number[]; average?: number | null; p75?: number | null; p95?: number | null }>;
};

export type History = {
  symbol: string;
  data_source: string;
  data_as_of: string;
  snapshot: Record<string, number | string | null>;
  records: HistoryRecord[];
};

export type MarketSnapshot = {
  asset: Asset;
  history?: History;
  forecast?: Forecast;
  errors: Array<{ kind: "history" | "forecast" | "asset"; message: string }>;
};

export type CompareSeries = {
  symbol: string;
  data_as_of: string;
  data_source: string;
  snapshot?: Record<string, number | string | null>;
  points: { date: string; price: number; normalized: number }[];
};

export type PeriodReturns = { symbol: string; data_as_of: string; returns: Record<string, number | null>; long_term_complete?: boolean };

export type Forecast = {
  symbol: string;
  best_model: string;
  base_price?: number | null;
  signal: "Up" | "Down" | "Observe";
  signal_quality: string;
  forecast_1d_return: number;
  forecast_1d_price: number;
  forecast_1d_direction: string;
  forecast_5d_return: number;
  forecast_5d_price: number;
  forecast_10d_return?: number | null;
  forecast_10d_price?: number | null;
  forecast_1m_return?: number | null;
  forecast_1m_price?: number | null;
  forecast_days: Record<string, number | string>[];
  forecast_volatility_1m?: number | null;
  expected_range_1m?: {
    low: number;
    high: number;
    return_low: number;
    return_high: number;
  } | null;
  kline_forecast?: {
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
  } | null;
  risk?: Record<string, number | string | null> | null;
  generated_at: string;
  data_as_of: string;
  validation_sample_size: number;
  beats_majority_baseline: boolean | null;
  explanation: string[];
  confidence_score?: number | null;
  score_components?: Record<string, number | string | null>;
  market_regime?: {
    regime: string;
    label_zh: string;
    label_en: string;
    daily_volatility: number;
    volume_ratio: number;
    benchmark_symbol?: string | null;
    benchmark_return_5d?: number | null;
    benchmark_return_20d?: number | null;
  } | null;
  action?: {
    stance: "accumulate" | "hold" | "reduce" | "wait";
    actionable: boolean;
    evidence_status: "validated" | "provisional" | "insufficient" | "negative_edge";
    label_zh: string;
    label_en: string;
    summary_zh: string;
    summary_en: string;
    abstain_reason_zh?: string | null;
    abstain_reason_en?: string | null;
  } | null;
  key_levels?: {
    support: number | null;
    resistance: number | null;
    stop_loss: number | null;
    breakout: number | null;
    invalidation: number | null;
    invalidation_zh: string;
    invalidation_en: string;
  } | null;
  scenarios?: {
    name: "bull" | "base" | "bear";
    label_zh: string;
    label_en: string;
    probability: number;
    calibrated?: false;
    expected_return: number;
    expected_price: number;
    narrative_zh: string;
    narrative_en: string;
  }[];
  forecast_intervals?: {
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
  }[];
  validation?: {
    backtest: {
      method: string;
      samples: number;
      direction_accuracy: number | null;
      majority_baseline_accuracy: number | null;
      direction_edge: number | null;
      return_mae: number | null;
      return_rmse: number | null;
    };
    live: {
      samples: number;
      direction_accuracy: number | null;
      majority_baseline_accuracy: number | null;
      direction_edge: number | null;
    };
    actionability: {
      actionable: boolean;
      evidence_status: string;
      minimum_backtest_samples: number;
      minimum_similar_samples: number;
      minimum_direction_edge: number;
      minimum_similar_hit_rate: number;
    };
  } | null;
  self_optimization?: {
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
  } | null;
  calibration?: {
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
  } | null;
  horizon_models?: {
    horizon: "1D" | "5D" | "10D" | "1M";
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
  }[];
  horizon_calibration?: Record<"1D" | "5D" | "10D" | "1M", {
    direction_probability: number | null;
    sample_size: number;
    validation_samples: number;
    direction_accuracy: number | null;
    majority_baseline_accuracy: number | null;
    direction_edge: number | null;
    calibrated: boolean;
  }>;
  model_governance?: ForecastGovernance | null;
  official_kronos?: {
    source: "official_kronos";
    model_id: string;
    tokenizer_id: string;
    generated_at: string;
    data_as_of: string;
    lookback: number;
    prediction_length: number;
    sample_count: number;
    forecast_path?: Array<Record<string, number | string>>;
  } | null;
  contextual_inputs?: {
    inputs: string[];
    score: number;
    fundamental_score: number;
    news_score: number;
    earnings_risk: boolean;
    earnings_date?: string | null;
    earnings_days?: number | null;
    overlay_weight?: number;
    forecast_adjustment?: Partial<Record<"1D" | "5D" | "10D" | "1M", number>>;
    drivers_zh?: string[];
    drivers_en?: string[];
  } | null;
  model_components?: {
    model: string;
    weight: number;
    direction: string;
    forecast_1d_return: number;
    forecast_5d_return: number;
    forecast_10d_return?: number | null;
    forecast_1m_return?: number | null;
    strength?: number | null;
  }[];
  drivers_zh?: string[];
  drivers_en?: string[];
};

export type Performance = {
  symbol: string;
  best_model: string;
  backtest: {
    best: Record<string, number | string | null>;
    models: Record<string, number | string | null>[];
    test_samples: number;
    evaluation_start?: string | null;
    evaluation_end?: string | null;
    horizon_statistics?: LedgerStat[];
  };
  live_predictions: {
    statistics: LedgerStat[];
    notice: string;
  };
};

export type LedgerStat = {
  horizon?: string;
  window: string;
  completed: number;
  pending: number;
  direction_accuracy?: number | null;
  majority_baseline_accuracy?: number | null;
  direction_edge?: number | null;
  mean_absolute_return_error?: number | null;
  median_absolute_return_error?: number | null;
  hit_count: number;
  miss_count: number;
};

export type PredictionHistory = {
  symbol: string;
  notice: string;
  statistics: LedgerStat[];
  records: Record<string, number | string | boolean | null>[];
  charts: {
    scatter: Record<string, number | string | null>[];
    timeline: Record<string, number | string | null>[];
    rolling_accuracy: Record<string, number | string | null>[];
    errors: Record<string, number | string | null>[];
  };
  backtest?: PredictionLedgerSection;
  live?: PredictionLedgerSection;
  legacy?: PredictionLedgerSection;
};

export type PredictionLedgerSection = {
  symbol: string;
  notice: string;
  statistics: LedgerStat[];
  horizon_statistics?: LedgerStat[];
  records: Record<string, number | string | boolean | null>[];
  charts: PredictionHistory["charts"];
};
