import type { Forecast, History } from "./types";

export type PortfolioAnalyticsHolding = {
  symbol: string;
  marketValue: number;
  forecast?: Forecast;
  history?: History;
};

export type PortfolioAnalytics = {
  weights: Record<string, number>;
  expectedReturns: Record<"1D" | "5D" | "10D" | "1M", number | null>;
  confidence: number | null;
  annualizedVolatility: number | null;
  maxDrawdown: number | null;
  topWeight: number;
  correlation: Array<{ symbol: string; values: Record<string, number | null> }>;
  stress: Array<{ id: "two_sigma" | "concentration" | "forecast_bear"; estimatedReturn: number | null }>;
  rebalance: Array<{ symbol: string; reason: "concentration" | "negative_forecast" | "low_confidence" | "positive_candidate"; weight: number; forecast1m: number | null; confidence: number | null }>;
};

export function calculatePortfolioAnalytics(holdings: PortfolioAnalyticsHolding[]): PortfolioAnalytics {
  const valid = holdings.filter((item) => item.marketValue > 0);
  const total = valid.reduce((sum, item) => sum + item.marketValue, 0);
  const weights = Object.fromEntries(valid.map((item) => [item.symbol, total ? item.marketValue / total : 0]));
  const expectedReturns = {
    "1D": weightedForecast(valid, weights, (forecast) => forecast.forecast_1d_return),
    "5D": weightedForecast(valid, weights, (forecast) => forecast.forecast_5d_return),
    "10D": weightedForecast(valid, weights, (forecast) => forecast.forecast_10d_return),
    "1M": weightedForecast(valid, weights, (forecast) => forecast.forecast_1m_return),
  };
  const confidence = weightedForecast(valid, weights, (forecast) => forecast.confidence_score, false);
  const returnMaps = Object.fromEntries(valid.map((item) => [item.symbol, dailyReturns(item.history)])) as Record<string, Map<string, number>>;
  const portfolioReturns = combinedPortfolioReturns(valid.map((item) => item.symbol), weights, returnMaps);
  const annualizedVolatility = portfolioReturns.length >= 10 ? standardDeviation(portfolioReturns) * Math.sqrt(252) : null;
  const maxDrawdown = portfolioReturns.length >= 2 ? drawdown(portfolioReturns) : null;
  const correlation = valid.map((item) => ({
    symbol: item.symbol,
    values: Object.fromEntries(valid.map((other) => [other.symbol, item.symbol === other.symbol ? 1 : correlationOf(returnMaps[item.symbol], returnMaps[other.symbol])])),
  }));
  const topWeight = Math.max(0, ...Object.values(weights));
  const monthlyVolatility = annualizedVolatility === null ? null : annualizedVolatility / Math.sqrt(12);
  const forecastBear = valid.reduce((sum, item) => {
    const interval = item.forecast?.expected_range_1m?.return_low;
    const fallback = item.forecast?.forecast_1m_return;
    return sum + (weights[item.symbol] || 0) * (finite(interval) ?? finite(fallback) ?? 0);
  }, 0);
  const stress = [
    { id: "two_sigma" as const, estimatedReturn: monthlyVolatility === null ? null : -2 * monthlyVolatility },
    { id: "concentration" as const, estimatedReturn: topWeight ? -0.2 * topWeight : null },
    { id: "forecast_bear" as const, estimatedReturn: valid.some((item) => item.forecast) ? forecastBear : null },
  ];
  const rebalance: PortfolioAnalytics["rebalance"] = [];
  valid.forEach((item) => {
    const weight = weights[item.symbol] || 0;
    const forecast1m = finite(item.forecast?.forecast_1m_return);
    const itemConfidence = finite(item.forecast?.confidence_score);
    if (weight > 0.35) rebalance.push({ symbol: item.symbol, reason: "concentration", weight, forecast1m, confidence: itemConfidence });
    else if (forecast1m !== null && forecast1m < 0) rebalance.push({ symbol: item.symbol, reason: "negative_forecast", weight, forecast1m, confidence: itemConfidence });
    else if (itemConfidence !== null && itemConfidence < 45) rebalance.push({ symbol: item.symbol, reason: "low_confidence", weight, forecast1m, confidence: itemConfidence });
    else if (weight < 0.2 && forecast1m !== null && forecast1m > 0.03 && (itemConfidence ?? 0) >= 55) rebalance.push({ symbol: item.symbol, reason: "positive_candidate", weight, forecast1m, confidence: itemConfidence });
  });
  return { weights, expectedReturns, confidence, annualizedVolatility, maxDrawdown, topWeight, correlation, stress, rebalance };
}

function weightedForecast(holdings: PortfolioAnalyticsHolding[], weights: Record<string, number>, select: (forecast: Forecast) => unknown, divideByCoverage = true): number | null {
  let weighted = 0;
  let coverage = 0;
  holdings.forEach((item) => {
    if (!item.forecast) return;
    const value = finite(select(item.forecast));
    if (value === null) return;
    const weight = weights[item.symbol] || 0;
    weighted += weight * value;
    coverage += weight;
  });
  if (!coverage) return null;
  return divideByCoverage ? weighted / coverage : weighted / coverage;
}

function dailyReturns(history?: History): Map<string, number> {
  const result = new Map<string, number>();
  const rows = [...(history?.records || [])].sort((left, right) => left.Date.localeCompare(right.Date));
  rows.forEach((row, index) => {
    const reported = finite(row.Daily_Return);
    const previous = finite(rows[index - 1]?.Price);
    const price = finite(row.Price);
    const value = reported ?? (previous && price !== null ? price / previous - 1 : null);
    if (value !== null && Math.abs(value) < 1) result.set(row.Date, value);
  });
  return result;
}

function combinedPortfolioReturns(symbols: string[], weights: Record<string, number>, maps: Record<string, Map<string, number>>): number[] {
  const dates = [...new Set(symbols.flatMap((symbol) => [...maps[symbol].keys()]))].sort();
  return dates.flatMap((date) => {
    const available = symbols.filter((symbol) => maps[symbol].has(date));
    const coverage = available.reduce((sum, symbol) => sum + (weights[symbol] || 0), 0);
    if (coverage < 0.5) return [];
    return [available.reduce((sum, symbol) => sum + (weights[symbol] || 0) / coverage * Number(maps[symbol].get(date)), 0)];
  });
}

function correlationOf(left: Map<string, number>, right: Map<string, number>): number | null {
  const pairs = [...left.entries()].flatMap(([date, value]) => right.has(date) ? [[value, Number(right.get(date))] as const] : []);
  if (pairs.length < 10) return null;
  const leftMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const rightMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  const numerator = pairs.reduce((sum, pair) => sum + (pair[0] - leftMean) * (pair[1] - rightMean), 0);
  const denominator = Math.sqrt(pairs.reduce((sum, pair) => sum + (pair[0] - leftMean) ** 2, 0) * pairs.reduce((sum, pair) => sum + (pair[1] - rightMean) ** 2, 0));
  return denominator ? numerator / denominator : null;
}

function standardDeviation(values: number[]): number {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, values.length - 1));
}

function drawdown(returns: number[]): number {
  let wealth = 1;
  let peak = 1;
  let worst = 0;
  returns.forEach((value) => {
    wealth *= 1 + value;
    peak = Math.max(peak, wealth);
    worst = Math.min(worst, wealth / peak - 1);
  });
  return worst;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
