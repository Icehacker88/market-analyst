import { describe, expect, it } from "vitest";
import { forecastDecision } from "./forecast-decision";
import type { Forecast } from "./types";

function fixture(overrides: Partial<Forecast> = {}): Forecast {
  return {
    symbol: "NVDA", best_model: "Orivane Ensemble", signal: "Up", signal_quality: "Medium",
    forecast_1d_return: 0.01, forecast_1d_price: 101, forecast_1d_direction: "Up",
    forecast_5d_return: 0.03, forecast_5d_price: 103, forecast_days: [], generated_at: "2026-08-05T00:00:00Z", data_as_of: "2026-08-04",
    validation_sample_size: 120, beats_majority_baseline: true, explanation: [],
    action: { stance: "accumulate", actionable: true, evidence_status: "validated", label_zh: "关注", label_en: "Watch", summary_zh: "", summary_en: "" },
    validation: {
      backtest: { method: "walk_forward", samples: 120, direction_accuracy: 58, majority_baseline_accuracy: 52, direction_edge: 6, return_mae: 0.01, return_rmse: 0.02 },
      live: { samples: 25, direction_accuracy: 60, majority_baseline_accuracy: 52, direction_edge: 8 },
      actionability: { actionable: true, evidence_status: "validated", minimum_backtest_samples: 60, minimum_similar_samples: 20, minimum_direction_edge: 0, minimum_similar_hit_rate: 50 },
    },
    ...overrides,
  };
}

describe("forecast decision", () => {
  it("keeps actionable language only when evidence gates pass", () => {
    expect(forecastDecision(fixture(), 62, "zh").actionable).toBe(true);
    expect(forecastDecision(fixture(), 62, "zh").title).toContain("分批");
  });

  it("switches to wait when frozen evidence is below baseline", () => {
    const forecast = fixture({
      action: { stance: "accumulate", actionable: true, evidence_status: "negative_edge", label_zh: "关注", label_en: "Watch", summary_zh: "", summary_en: "" },
      validation: {
        backtest: { method: "walk_forward", samples: 120, direction_accuracy: 49, majority_baseline_accuracy: 54, direction_edge: -5, return_mae: 0.01, return_rmse: 0.02 },
        live: { samples: 25, direction_accuracy: 44, majority_baseline_accuracy: 52, direction_edge: -8 },
        actionability: { actionable: false, evidence_status: "negative_edge", minimum_backtest_samples: 60, minimum_similar_samples: 20, minimum_direction_edge: 0, minimum_similar_hit_rate: 50 },
      },
    });
    const decision = forecastDecision(forecast, 70, "zh");
    expect(decision.actionable).toBe(false);
    expect(decision.title).toBe("等待确认");
    expect(decision.reason).toContain("未优于简单基准");
  });
});
