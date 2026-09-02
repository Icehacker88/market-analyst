import type { Forecast, History, LedgerStat, Performance } from "./types";

export type ForecastCredibility = {
  stale: boolean;
  lagDays: number;
  forecastDate: string;
  marketDate: string;
  rangeLow: number | null;
  rangeHigh: number | null;
};

export type PredictionScore = {
  score: number;
  label: "low" | "medium" | "high";
  reasons: string[];
};

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})/);
  const normalized = compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : value.slice(0, 10);
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function forecastCredibility(forecast: Forecast, history: History): ForecastCredibility {
  const forecastDate = parseDate(forecast.data_as_of);
  const marketDate = parseDate(history.data_as_of);
  const lagDays = forecastDate && marketDate ? Math.max(0, Math.round((marketDate.getTime() - forecastDate.getTime()) / 86_400_000)) : 0;
  const latestPrice = Number(history.snapshot.latest_price);
  const annualizedVolatility = Number(history.snapshot.annualized_volatility_20d);
  const dailyMove = Number.isFinite(latestPrice) && Number.isFinite(annualizedVolatility)
    ? latestPrice * annualizedVolatility / Math.sqrt(252) * 1.96
    : null;
  return {
    stale: !forecastDate || !marketDate || lagDays > 0,
    lagDays,
    forecastDate: forecast.data_as_of,
    marketDate: history.data_as_of,
    rangeLow: dailyMove === null ? null : Math.max(0, forecast.forecast_1d_price - dailyMove),
    rangeHigh: dailyMove === null ? null : forecast.forecast_1d_price + dailyMove,
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function predictionScore(
  forecast: Forecast,
  history: History,
  credibility: ForecastCredibility,
  stats?: LedgerStat,
  performance?: Performance,
): PredictionScore {
  if (typeof forecast.confidence_score === "number" && Number.isFinite(forecast.confidence_score)) {
    let score = forecast.confidence_score;
    const reasons = ["cloud_score"];
    if (credibility.stale) {
      score -= 28;
      reasons.push("stale");
    }
    if ((stats?.completed ?? 0) === 0) {
      score -= 8;
      reasons.push("few_samples");
    }
    const calibration = forecast.calibration;
    if (calibration && calibration.sample_size >= 20 && typeof calibration.direction_hit_rate === "number") {
      score += calibration.direction_hit_rate >= 56 ? 6 : calibration.direction_hit_rate < 48 ? -7 : 0;
      reasons.push("calibration");
    } else if (calibration && calibration.sample_size > 0) {
      score -= 3;
      reasons.push("thin_calibration");
    }
    const backtestEdge = finiteNumber(forecast.validation?.backtest.direction_edge);
    if (backtestEdge !== null) {
      score += backtestEdge > 0 ? Math.min(8, backtestEdge * 0.5) : -Math.min(18, Math.abs(backtestEdge) * 0.8 + 8);
      reasons.push("walk_forward_edge");
    }
    if (forecast.action?.actionable === false) {
      score -= 8;
      reasons.push("abstained");
    }
    const finalScore = Math.round(Math.max(0, Math.min(100, score)));
    return { score: finalScore, label: finalScore >= 72 ? "high" : finalScore >= 52 ? "medium" : "low", reasons };
  }
  const completed = stats?.completed ?? 0;
  const directionEdge = finiteNumber(stats?.direction_edge);
  const directionAccuracy = finiteNumber(stats?.direction_accuracy);
  const backtestEdge = finiteNumber(performance?.backtest.best.Directional_Edge);
  const dailyVolatility = finiteNumber(history.snapshot.annualized_volatility_20d);
  const volatilityStrength = dailyVolatility && dailyVolatility > 0
    ? Math.min(2, Math.abs(forecast.forecast_1d_return) / (dailyVolatility / Math.sqrt(252)))
    : 0;
  let score = 45;
  const reasons: string[] = [];
  if (credibility.stale) {
    score -= 28;
    reasons.push("stale");
  }
  if (completed >= 20) {
    score += 14;
    reasons.push("live_samples");
  } else if (completed >= 5) {
    score += 7;
    reasons.push("limited_samples");
  } else {
    score -= 8;
    reasons.push("few_samples");
  }
  if (directionEdge !== null) {
    score += directionEdge > 0 ? Math.min(18, directionEdge * 0.8) : -Math.min(14, Math.abs(directionEdge) * 0.6);
  } else if (backtestEdge !== null) {
    score += backtestEdge > 0 ? Math.min(10, backtestEdge * 0.5) : -Math.min(8, Math.abs(backtestEdge) * 0.4);
  }
  if (directionAccuracy !== null) {
    score += directionAccuracy >= 55 ? 8 : directionAccuracy >= 50 ? 3 : -7;
  }
  score += forecast.signal_quality === "High" ? 12 : forecast.signal_quality === "Medium" ? 6 : -5;
  score += forecast.beats_majority_baseline === true ? 6 : forecast.beats_majority_baseline === false ? -4 : 0;
  score += Math.min(10, volatilityStrength * 5);
  const finalScore = Math.round(Math.max(0, Math.min(100, score)));
  return {
    score: finalScore,
    label: finalScore >= 72 ? "high" : finalScore >= 52 ? "medium" : "low",
    reasons,
  };
}
