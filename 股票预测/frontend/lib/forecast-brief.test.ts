import { describe, expect, it } from "vitest";
import { directionalLevels, forecastBrief } from "./forecast-brief";
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

  it("only describes conditions when the action is not actionable", () => {
    const brief = forecastBrief(fixture({ action: { stance: "hold", actionable: false, evidence_status: "negative_edge", label_zh: "观察", label_en: "Watch", summary_zh: "", summary_en: "" } }), "zh");
    expect(brief.holderAdvice).toContain("不据此加仓或减仓");
    expect(brief.holderAdvice).not.toMatch(/考虑减仓|分批加仓/);
    expect(brief.newcomerAdvice).toContain("不构成入场依据");
    expect(brief.newcomerAdvice).not.toContain("再入场");
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

  // NVDA on 2026-10-16: a bearish "Observe" forecast whose invalidation sits above price.
  const bearish = fixture({
    signal: "Observe", base_price: 215.89, forecast_1d_return: -0.003, forecast_5d_return: -0.012, forecast_1m_return: -0.004,
    action: { stance: "wait", actionable: false, evidence_status: "insufficient", label_zh: "仅作方向观察", label_en: "Directional watch only", summary_zh: "", summary_en: "" },
    key_levels: { support: 215.89, resistance: 239.24, stop_loss: 207.95, breakout: 241.63, invalidation: 239.24, invalidation_zh: "", invalidation_en: "" },
  });

  it("puts a bearish invalidation above price and the downside level below it", () => {
    expect(directionalLevels(bearish)).toEqual({ downside: 207.95, upside: 239.24, support: 215.89 });
    const brief = forecastBrief(bearish, "zh");
    expect(brief.holderAdvice).toContain("下方关注 207.95");
    expect(brief.holderAdvice).not.toContain("跌破 239.24");
    expect(`${brief.holderAdvice}${brief.newcomerAdvice}`).not.toContain("241.63");
  });

  it("keeps a bullish invalidation as the downside level", () => {
    expect(directionalLevels(fixture({ base_price: 100 }))).toEqual({ downside: 92, upside: 105, support: 95 });
    const hold = forecastBrief(fixture({ base_price: 100, action: { stance: "hold", actionable: true, evidence_status: "validated", label_zh: "", label_en: "", summary_zh: "", summary_en: "" } }), "zh");
    expect(hold.holderAdvice).toContain("跌破 92 时考虑减仓");
  });

  it("uses the current price over the forecast base price when given", () => {
    expect(directionalLevels(bearish, 240).upside).toBe(241.63);
    expect(directionalLevels(bearish, 240).downside).toBe(239.24);
  });

  it("falls back to the forecast base price when the current price is missing", () => {
    const bullish = fixture({ base_price: 100 });
    for (const missing of [null, undefined, "", 0, -5, Number.NaN]) {
      expect(directionalLevels(bullish, missing)).toEqual({ downside: 92, upside: 105, support: 95 });
    }
  });
});
