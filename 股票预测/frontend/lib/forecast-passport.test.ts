import { describe, expect, it } from "vitest";
import { forecastPassport } from "./forecast-passport";
import type { Forecast } from "./types";

function fixture(overrides: Partial<Forecast> = {}): Forecast {
  return {
    symbol: "NVDA",
    best_model: "Orivane Ensemble",
    signal: "Up",
    signal_quality: "Medium",
    forecast_1d_return: 0.01,
    forecast_1d_price: 101,
    forecast_1d_direction: "Up",
    forecast_5d_return: 0.03,
    forecast_5d_price: 103,
    forecast_10d_return: 0.04,
    forecast_10d_price: 104,
    forecast_1m_return: 0.06,
    forecast_1m_price: 106,
    forecast_days: [],
    generated_at: "2026-07-12T00:00:00Z",
    data_as_of: "2026-07-11",
    validation_sample_size: 120,
    beats_majority_baseline: true,
    explanation: [],
    horizon_models: [{
      horizon: "1D",
      selected_model: "Momentum",
      forecast_return: 0.012,
      direction: "Up",
      direction_probability: 58,
      probability_samples: 40,
      validation_samples: 40,
      direction_accuracy: 58,
      majority_baseline_accuracy: 52,
      direction_edge: 6,
      return_rmse: 0.02,
      promoted: true,
      reason_zh: "",
      reason_en: "",
    }],
    ...overrides,
  };
}

describe("forecast passport", () => {
  it("marks a promoted positive-edge horizon as validated", () => {
    const row = forecastPassport(fixture(), "2026-07-11")[0];
    expect(row.state).toBe("validated");
    expect(row.validationSamples).toBe(40);
    expect(row.forecastReturn).toBe(0.012);
  });

  it("blocks validation when the benchmark edge is not positive", () => {
    const forecast = fixture();
    forecast.horizon_models![0] = { ...forecast.horizon_models![0], direction_edge: -2 };
    expect(forecastPassport(forecast)[0].state).toBe("negative_edge");
  });

  it("marks every horizon stale when market data is newer", () => {
    expect(forecastPassport(fixture(), "2026-07-12").every((row) => row.state === "stale")).toBe(true);
  });
});
