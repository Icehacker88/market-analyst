import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Forecast, History } from "@/lib/types";
import { PredictionHero } from "./detail-panel";

// Stable like the real provider.
const app = vi.hoisted(() => ({ language: "zh", t: (key: string) => key, updateUserState: () => {}, userState: {} }));
vi.mock("./providers", () => ({ useApp: () => app }));

afterEach(cleanup);

// NVDA on 2026-10-16: a bearish "Observe" forecast frozen at 215.89.
const forecast = {
  symbol: "NVDA", best_model: "Orivane Ensemble Safe Mode", signal: "Observe", signal_quality: "Medium", base_price: 215.89,
  forecast_1d_return: -0.003, forecast_1d_price: 215.2, forecast_1d_direction: "Down",
  forecast_5d_return: -0.012, forecast_5d_price: 213.3, forecast_10d_return: -0.015, forecast_10d_price: 212.6, forecast_1m_return: -0.004, forecast_1m_price: 215,
  forecast_days: [], generated_at: "2026-10-16T17:41:31Z", data_as_of: "2026-10-16", validation_sample_size: 0, beats_majority_baseline: false, explanation: [],
  action: { stance: "wait", actionable: false, evidence_status: "insufficient", label_zh: "仅作方向观察", label_en: "Directional watch only", summary_zh: "", summary_en: "" },
  key_levels: { support: 215.89, resistance: 239.24, stop_loss: 207.95, breakout: 241.63, invalidation: 239.24, invalidation_zh: "", invalidation_en: "" },
} as unknown as Forecast;

function history(latest: number | null): History {
  return { symbol: "NVDA", data_source: "yahoo", data_as_of: "2026-10-16", snapshot: { latest_price: latest } as History["snapshot"], records: [{ Date: "2026-10-16", Price: latest ?? 215.89 }] };
}

function adviceText(container: HTMLElement) {
  const text = container.textContent || "";
  const held = text.slice(text.indexOf("已经持有"), text.indexOf("尚未买入"));
  const fresh = text.slice(text.indexOf("尚未买入"), text.indexOf("按你的条件调整"));
  const tailored = text.slice(text.indexOf("按你的条件调整"), text.indexOf("重新评估", text.indexOf("按你的条件调整")) + 4);
  return { held, fresh, tailored };
}

describe("PredictionHero advice levels", () => {
  it("names the same upside level everywhere once price trades above the frozen invalidation", () => {
    const { container } = render(<PredictionHero forecast={forecast} history={history(240)} />);
    const { held, fresh, tailored } = adviceText(container);
    for (const block of [held, fresh, tailored]) {
      expect(block).toContain("241.63");
      expect(block).not.toContain("站上 239.24");
    }
    expect(held).toContain("下方关注 239.24");
  });

  it("uses the frozen invalidation above price when price is still below it", () => {
    const { container } = render(<PredictionHero forecast={forecast} history={history(217)} />);
    const { held, fresh, tailored } = adviceText(container);
    for (const block of [held, fresh, tailored]) {
      expect(block).toContain("239.24");
      expect(block).not.toContain("241.63");
    }
    expect(held).toContain("下方关注 207.95");
  });

  it("falls back to the frozen base price when the snapshot has no price", () => {
    const { container } = render(<PredictionHero forecast={forecast} history={history(null)} />);
    const { held, tailored } = adviceText(container);
    expect(held).toContain("下方关注 207.95");
    expect(tailored).toContain("239.24");
  });
});
