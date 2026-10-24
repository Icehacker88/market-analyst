import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvidenceGate, ForecastScoreboard, LedgerStat } from "@/lib/types";
import { HomeScoreboard } from "./home-scoreboard";

const resource = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("./providers", () => ({ useApp: () => ({ language: "zh" }) }));
vi.mock("./app-link", () => ({ AppLink: ({ children }: { children: unknown }) => children }));
vi.mock("./use-home-resource", () => ({ useHomeResource: () => ({ data: resource.data, status: "ready", refreshing: false, failed: false, refresh: () => {} }) }));

afterEach(cleanup);

const stat = (extra: Partial<LedgerStat> = {}): LedgerStat => ({ window: "All", completed: 100, pending: 0, hit_count: 70, miss_count: 30, direction_accuracy: 70, majority_baseline_accuracy: 52, direction_edge: 18, ...extra });
const met: EvidenceGate = { rule: "wilson95-low-gt-majority-v1", policy_version: "cloud-forecast-policy-v1", status: "met", samples: 80, required: 60, hits: 56, direction_accuracy: 70, ci_low: 59.2, ci_high: 78.9, majority_baseline_accuracy: 52 };
function board(assets: string[], gate: EvidenceGate = met): ForecastScoreboard {
  return { scope: "core", symbols: ["SPY", "QQQ", "NVDA"], data_as_of: "2026-10-23", generated_at: "2026-10-24T00:00:00Z", methodology: {},
    backtest: { statistics: [stat({ direction_edge: 3 })], horizon_statistics: [] },
    live: { statistics: [stat({ protocol: "frozen-close-v1" })], horizon_statistics: [] },
    per_asset: assets.map((symbol) => ({ symbol, data_as_of: "2026-10-23", backtest: { statistics: [], horizon_statistics: [] }, live: { statistics: [], horizon_statistics: [] },
      governance: { status: "stable", active_model: "Orivane Horizon Router", evaluated_at: "2026-10-24", live_samples_20: 20, live_samples_all: gate.samples, direction_edge_20: 5, direction_edge_all: 18, drift_score: 0, rollback_count: 0, reason_zh: "", reason_en: "", evidence_gate: gate } })) };
}
const hint = "当前模型尚未证明优于简单基准。";

describe("HomeScoreboard evidence gate", () => {
  it("hides the warning only when every expected core asset meets its own gate", () => {
    resource.data = board(["SPY", "QQQ", "NVDA"]);
    render(<HomeScoreboard />);
    expect(screen.queryByText(hint, { exact: false })).toBeNull();
    expect(screen.getByTestId("home-evidence-progress").textContent).toContain("SPY 60/60 · QQQ 60/60 · NVDA 60/60");
  });

  it.each([[["SPY"]], [["SPY", "QQQ"]]])("keeps the warning and shows missing data when only %j are returned", (assets) => {
    resource.data = board(assets);
    render(<HomeScoreboard />);
    expect(screen.getByText(hint, { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId("home-evidence-progress").textContent).toContain("NVDA 数据缺失");
  });

  it("keeps the warning while any asset is still accumulating, despite a strong cross-asset total", () => {
    resource.data = board(["SPY", "QQQ", "NVDA"], { ...met, status: "insufficient", samples: 12 });
    render(<HomeScoreboard />);
    expect(screen.getByText(hint, { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId("home-evidence-progress").textContent).toContain("SPY 12/60");
  });
});
