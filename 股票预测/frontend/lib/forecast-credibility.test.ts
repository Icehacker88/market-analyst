import { describe, expect, it } from "vitest";
import { forecastCredibility, predictionScore } from "./forecast-credibility";
import type { Forecast, History } from "./types";

const forecast = { data_as_of: "2026-06-08", forecast_1d_price: 100 } as Forecast;
const history: History = { symbol: "TEST", data_source: "test", data_as_of: "2026-06-18", snapshot: { latest_price: 100, annualized_volatility_20d: 0.2 }, records: [] };

describe("forecastCredibility", () => {
  it("marks a lagging forecast stale", () => {
    const result = forecastCredibility(forecast, history);
    expect(result.stale).toBe(true);
    expect(result.lagDays).toBe(10);
  });

  it("keeps a current forecast active", () => {
    expect(forecastCredibility({ ...forecast, data_as_of: "2026-06-18" }, history).stale).toBe(false);
  });

  it("marks a forecast stale as soon as a newer market session exists", () => {
    expect(forecastCredibility({ ...forecast, data_as_of: "2026-06-17" }, history).stale).toBe(true);
  });

  it("returns a volatility range around the forecast", () => {
    const result = forecastCredibility(forecast, history);
    expect(result.rangeLow).toBeLessThan(100);
    expect(result.rangeHigh).toBeGreaterThan(100);
  });

  it("scores stale unverified forecasts lower than current validated forecasts", () => {
    const stale = forecastCredibility({ ...forecast, forecast_1d_return: 0.01, signal_quality: "Low" } as Forecast, history);
    const currentForecast = { ...forecast, data_as_of: "2026-06-18", forecast_1d_return: 0.01, signal_quality: "High", beats_majority_baseline: true } as Forecast;
    const current = forecastCredibility(currentForecast, history);
    const weakScore = predictionScore({ ...forecast, forecast_1d_return: 0.01, signal_quality: "Low" } as Forecast, history, stale, { window: "All", completed: 0, pending: 1, hit_count: 0, miss_count: 0 });
    const strongScore = predictionScore(currentForecast, history, current, { window: "All", completed: 25, pending: 0, direction_accuracy: 58, majority_baseline_accuracy: 51, direction_edge: 7, hit_count: 15, miss_count: 10 });
    expect(strongScore.score).toBeGreaterThan(weakScore.score);
  });

  it("penalizes a forecast that abstains after negative walk-forward edge", () => {
    const currentForecast = {
      ...forecast,
      data_as_of: "2026-06-18",
      forecast_1d_return: 0.01,
      signal_quality: "High",
      confidence_score: 70,
      validation: { backtest: { direction_edge: -4 }, live: { samples: 2 } },
      action: { actionable: false },
    } as Forecast;
    const credibility = forecastCredibility(currentForecast, history);
    expect(predictionScore(currentForecast, history, credibility).score).toBeLessThan(55);
  });
});
