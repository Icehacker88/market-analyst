import { describe, expect, it } from "vitest";
import { forecastBrief } from "./forecast-brief";
import type { Forecast } from "./types";

function fixture(overrides: Partial<Forecast> = {}): Forecast {
  return {
    symbol: "NVDA", best_model: "Orivane Ensemble", signal: "Up", signal_quality: "Medium",
    forecast_1d_return: 0.01, forecast_1d_price: 101, forecast_1d_direction: "Up",
    forecast_5d_return: 0.03, forecast_5d_price: 103, forecast_1m_return: 0.06, forecast_1m_price: 106,
    forecast_days: [], generated_at: "2026-07-12T00:00:00Z", data_as_of: "2026-07-11",
    validation_sample_size: 120, beats_majority_baseline: true, explanation: [],
    calibration: { sample_size: 40, total_samples: 120, confidence_bucket: "medium", direction_hit_rate: 62, average_1d_return: null, average_5d_return: null, average_10d_return: null, average_1m_return: null, note_zh: "", note_en: "" },
    action: { stance: "accumulate", actionable: true, evidence_status: "validated", label_zh: "关注", label_en: "Watch", summary_zh: "", summary_en: "" },
    key_levels: { support: 95, resistance: 105, stop_loss: 92, breakout: 105, invalidation: 92, invalidation_zh: "", invalidation_en: "" },
    ...overrides,
  };
}

describe("forecast brief", () => {
  it("uses similar-signal accuracy as the estimated trend probability", () => {
    const brief = forecastBrief(fixture(), "zh");
    expect(brief.probability).toBe(62);
    expect(brief.probabilityNote).toContain("40 个历史相似信号");
    expect(brief.holderAdvice).toContain("加仓");
    expect(brief.newcomerAdvice).toContain("分批入场");
  });

  it("does not recommend adding when the action is not actionable", () => {
    const brief = forecastBrief(fixture({ action: { stance: "wait", actionable: false, evidence_status: "negative_edge", label_zh: "观察", label_en: "Watch", summary_zh: "", summary_en: "" } }), "zh");
    expect(brief.holderAdvice).toContain("暂不加仓");
    expect(brief.newcomerAdvice).toContain("等待");
  });

  it("does not present a holdout direction share from fewer than 20 samples", () => {
    const brief = forecastBrief(fixture({
      calibration: { sample_size: 0, total_samples: 0, confidence_bucket: "low", direction_hit_rate: null, average_1d_return: null, average_5d_return: null, average_10d_return: null, average_1m_return: null, note_zh: "", note_en: "" },
      horizon_models: [{
        horizon: "1M", selected_model: "Historical Analogs", forecast_return: 0.02, direction: "Up",
        validation_samples: 19, probability_samples: 19, direction_probability: 55,
        direction_accuracy: 55, majority_baseline_accuracy: 52, direction_edge: 3,
        return_rmse: 0.01, promoted: true, reason_zh: "", reason_en: "",
      }],
    }), "zh");
    expect(brief.probability).toBeNull();
    expect(brief.probabilityNote).toBe("尚无足够历史样本");
  });
});
