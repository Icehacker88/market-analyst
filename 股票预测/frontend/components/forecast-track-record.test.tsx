import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import type { EvidenceGate, ForecastScoreboard, LedgerStat } from "@/lib/types";
import { ForecastTrackRecord } from "./forecast-track-record";

const app = vi.hoisted(() => ({ language: "zh", t: (key: string) => key }));
vi.mock("./providers", () => ({ useApp: () => app }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/api", () => ({ getForecastScoreboard: vi.fn() }));

afterEach(cleanup);

const stat = (horizon: string, extra: Partial<LedgerStat> = {}): LedgerStat => ({ horizon, window: "All", completed: 0, pending: 0, hit_count: 0, miss_count: 0, direction_accuracy: null, majority_baseline_accuracy: null, direction_edge: null, ...extra });
const backtestStat = (horizon: string) => stat(horizon, { completed: 360, direction_accuracy: 47, majority_baseline_accuracy: 52.3, direction_edge: -5.3 });
// Right after the timing contract ships: legacy outcomes exist but none qualify.
const liveStat = (horizon: string) => stat(horizon, { protocol: "frozen-close-v1", policy_version: "cloud-forecast-policy-v1", observed: 49, eligible: 0, ineligible: 22, unknown: 28, excluded: 49 });
const gate = (status: EvidenceGate["status"], samples: number, extra: Partial<EvidenceGate> = {}): EvidenceGate => ({ rule: "wilson95-low-gt-majority-v1", policy_version: "cloud-forecast-policy-v1", status, samples, required: 60, hits: 0, direction_accuracy: null, ci_low: null, ci_high: null, majority_baseline_accuracy: null, ...extra });
// One per_asset entry per core symbol (SPY, QQQ, NVDA), each with the same gate unless `only` limits them.
const withGate = (board: ForecastScoreboard, evidence: EvidenceGate | null, only = board.symbols): ForecastScoreboard => ({ ...board,
  per_asset: only.map((symbol) => ({ ...board.per_asset[0], symbol, governance: board.per_asset[0].governance ? { ...board.per_asset[0].governance, evidence_gate: evidence } : null })) });
const timing = (status: string, reason: string) => Object.fromEntries(["1D", "5D", "10D", "1M"].map((h) => [h, { status, reason, protocol: "frozen-close-v1", policy_version: "cloud-forecast-policy-v1" }]));

const scoreboard: ForecastScoreboard = {
  scope: "core", symbols: ["SPY", "QQQ", "NVDA"], data_as_of: "2026-10-19", generated_at: "2026-10-20T00:00:00Z", methodology: {},
  backtest: { statistics: [backtestStat("1D")], horizon_statistics: ["1D", "5D", "10D", "1M"].map(backtestStat) },
  live: { statistics: [liveStat("1D")], horizon_statistics: ["1D", "5D", "10D", "1M"].map(liveStat) },
  per_asset: [{ symbol: "SPY", data_as_of: "2026-10-19", backtest: { statistics: [backtestStat("1D")], horizon_statistics: [] }, live: { statistics: [liveStat("1D")], horizon_statistics: [] },
    governance: { status: "warming_up", active_model: "Orivane Ensemble Safe Mode", evaluated_at: "2026-10-20", live_samples_20: 0, live_samples_all: 0, direction_edge_20: null, direction_edge_all: null, drift_score: 0, rollback_count: 0, reason_zh: "时间资格通过的已结算样本 0 个；不足 20 个，保持保守组合。", reason_en: "" } }],
  monitored_symbols: ["SPY", "AAPL"],
  recent_live_records: [
    { Symbol: "SPY", As_Of_Date: "2026-10-20", Best_Model: "Orivane Ensemble Safe Mode", Forecast_1D_Return: 0.002, Verified: false, Time_Eligibility: timing("eligible", "qualified"), Outcome_Observed: { "1D": false }, Settlement_Status: { "1D": "awaiting_target_close" } },
    { Symbol: "SPY", As_Of_Date: "2026-09-24", Best_Model: "Orivane Ensemble Safe Mode", Forecast_1D_Return: 0.001, Actual_1D_Return: -0.004, Verified: false, Time_Eligibility: timing("ineligible", "published_after_target_open"), Outcome_Observed: { "1D": true } },
    { Symbol: "AAPL", As_Of_Date: "2026-09-10", Best_Model: "Orivane Horizon Router", Forecast_1D_Return: -0.001, Actual_1D_Return: 0.003, Verified: false, Time_Eligibility: timing("unknown", "legacy_snapshot_missing"), Outcome_Observed: { "1D": true } },
  ],
};

describe("ForecastTrackRecord with the frozen-close timing contract", () => {
  it("shows qualified live samples, excluded outcomes and reasons without fake 0% or negative edges", async () => {
    vi.mocked(api.getForecastScoreboard).mockResolvedValue(scoreboard);
    const { container } = render(<ForecastTrackRecord />);
    // Backtest edge is negative, so the banner keeps the below-baseline verdict.
    await waitFor(() => expect(screen.getByText("当前模型尚未证明优于简单基准")).toBeInTheDocument());

    const summary = container.querySelector(".score-summary")!;
    const qualified = within(summary as HTMLElement).getByText("合格实盘样本").closest("article")!;
    expect(qualified.querySelector("strong")!.textContent).toBe("0");
    expect(qualified.textContent).toContain("另有 49 条已有结果但不计入");
    const liveEdge = within(summary as HTMLElement).getByText("实盘方向优势").closest("article")!.querySelector("strong")!;
    expect(liveEdge.textContent).toBe("—");
    expect(liveEdge.className).toBe("");
    expect(container.textContent).toContain("不含分红的价格收益");

    const eligibility = container.querySelector(".score-eligibility")!;
    const oneDay = within(eligibility as HTMLElement).getAllByRole("row")[1];
    expect([...oneDay.querySelectorAll("td")].map((cell) => cell.textContent)).toEqual(
      ["1D", "49", "0", "49", "0", "22", "28", "生成或冻结晚于目标交易日开盘（1）；历史记录缺少冻结证据（1）"]);

    const records = container.querySelector(".score-public-records")!;
    const states = [...records.querySelectorAll(".record-state")].map((node) => node.textContent);
    expect(states).toEqual(["等待结果", "不计入", "不计入"]);
    expect(records.textContent).toContain("等待目标交易日收盘");
    expect(records.textContent).not.toContain("已结算");
    expect(container.querySelector(".governance-status")!.textContent).toBe("合格样本积累中");
  });

  it("shows qualified-sample progress in the banner while live evidence accumulates", async () => {
    const positive = (horizon: string) => ({ ...backtestStat(horizon), direction_edge: 2.1 });
    vi.mocked(api.getForecastScoreboard).mockResolvedValue(withGate({ ...scoreboard, backtest: { statistics: [positive("1D")], horizon_statistics: ["1D", "5D", "10D", "1M"].map(positive) } }, gate("insufficient", 0)));
    render(<ForecastTrackRecord />);
    await waitFor(() => expect(screen.getByText("实盘证据积累中（SPY 0/60 · QQQ 0/60 · NVDA 0/60）")).toBeInTheDocument());
    expect(screen.getAllByText("等待合格样本").length).toBe(4);
  });

  it("does not treat an old cached response as qualified or validated", async () => {
    const oldLive = (horizon: string) => stat(horizon, { completed: 100, direction_accuracy: 60, majority_baseline_accuracy: 52, direction_edge: 8 });
    const positive = (horizon: string) => ({ ...backtestStat(horizon), direction_edge: 2.1 });
    vi.mocked(api.getForecastScoreboard).mockResolvedValue({ ...scoreboard,
      backtest: { statistics: [positive("1D")], horizon_statistics: ["1D", "5D", "10D", "1M"].map(positive) },
      live: { statistics: [oldLive("1D")], horizon_statistics: ["1D", "5D", "10D", "1M"].map(oldLive) },
      recent_live_records: [{ Symbol: "SPY", As_Of_Date: "2026-09-10", Best_Model: "Orivane Horizon Router", Forecast_1D_Return: 0.001, Actual_1D_Return: 0.002, Verified: true }] });
    const { container } = render(<ForecastTrackRecord />);
    await waitFor(() => expect(screen.getByText("实盘成绩暂不可判定")).toBeInTheDocument());
    expect(container.textContent).not.toContain("各核心资产均已达到既定证据门槛");
    const qualified = within(container.querySelector(".score-summary") as HTMLElement).getByText("合格实盘样本").closest("article")!;
    expect(qualified.querySelector("strong")!.textContent).toBe("—");
    expect([...container.querySelectorAll(".record-state")].map((node) => node.textContent)).toEqual(["不计入"]);
    expect(container.textContent).not.toContain("已计入（");
  });

  it.each([
    ["an asset with 60 samples whose lower bound does not beat the baseline", gate("not_met", 60, { direction_accuracy: 55, ci_low: 42.5, ci_high: 67, majority_baseline_accuracy: 53 }), "当前模型尚未证明优于简单基准"],
    ["59 samples", gate("insufficient", 59), "实盘证据积累中（SPY 59/60 · QQQ 59/60 · NVDA 59/60）"],
    ["no gate in the response (old cache)", null, "实盘成绩暂不可判定"],
    ["a met gate", gate("met", 80, { direction_accuracy: 70, ci_low: 59.2, ci_high: 78.9, majority_baseline_accuracy: 52 }), "各核心资产均已达到既定证据门槛"],
  ])("banner for %s", async (_name, evidence, title) => {
    const positive = (horizon: string) => ({ ...backtestStat(horizon), direction_edge: 2.1 });
    vi.mocked(api.getForecastScoreboard).mockResolvedValue(withGate({ ...scoreboard,
      backtest: { statistics: [positive("1D")], horizon_statistics: ["1D", "5D", "10D", "1M"].map(positive) } }, evidence as EvidenceGate | null));
    const { container } = render(<ForecastTrackRecord />);
    await waitFor(() => expect(screen.getByText(title as string)).toBeInTheDocument());
    if (evidence) expect(container.querySelector(".score-assets")!.textContent).toContain(`${(evidence as EvidenceGate).samples}/60`);
  });

  it.each([[["SPY"]], [["SPY", "QQQ"]]])("never claims every asset met when core assets %j are the only ones returned", async (only) => {
    const positive = (horizon: string) => ({ ...backtestStat(horizon), direction_edge: 2.1 });
    const met = gate("met", 80, { direction_accuracy: 70, ci_low: 59.2, ci_high: 78.9, majority_baseline_accuracy: 52 });
    vi.mocked(api.getForecastScoreboard).mockResolvedValue(withGate({ ...scoreboard,
      backtest: { statistics: [positive("1D")], horizon_statistics: ["1D", "5D", "10D", "1M"].map(positive) } }, met, only));
    const { container } = render(<ForecastTrackRecord />);
    await waitFor(() => expect(screen.getByText("实盘成绩暂不可判定")).toBeInTheDocument());
    expect(container.textContent).not.toContain("各核心资产均已达到既定证据门槛");
  });

  it("treats gates from another policy version as missing, never as met", async () => {
    const positive = (horizon: string) => ({ ...backtestStat(horizon), direction_edge: 2.1 });
    vi.mocked(api.getForecastScoreboard).mockResolvedValue(withGate({ ...scoreboard,
      backtest: { statistics: [positive("1D")], horizon_statistics: ["1D", "5D", "10D", "1M"].map(positive) } },
      gate("met", 80, { policy_version: "cloud-forecast-policy-v0", direction_accuracy: 70, ci_low: 59.2, ci_high: 78.9, majority_baseline_accuracy: 52 })));
    const { container } = render(<ForecastTrackRecord />);
    await waitFor(() => expect(screen.getByText("实盘成绩暂不可判定")).toBeInTheDocument());
    expect(container.textContent).not.toContain("各核心资产均已达到既定证据门槛");
  });

  it("never validates from a strong cross-asset total while an asset's own gate is short", async () => {
    const positive = (horizon: string) => ({ ...backtestStat(horizon), direction_edge: 2.1 });
    const strongTotal = (horizon: string) => stat(horizon, { protocol: "frozen-close-v1", policy_version: "cloud-forecast-policy-v1", completed: 100, direction_accuracy: 70, majority_baseline_accuracy: 52, direction_edge: 18, direction_accuracy_ci_low: 60.4, direction_accuracy_ci_high: 78.1, observed: 100, eligible: 100, ineligible: 0, unknown: 0, excluded: 0 });
    vi.mocked(api.getForecastScoreboard).mockResolvedValue(withGate({ ...scoreboard,
      backtest: { statistics: [positive("1D")], horizon_statistics: ["1D", "5D", "10D", "1M"].map(positive) },
      live: { statistics: [strongTotal("1D")], horizon_statistics: ["1D", "5D", "10D", "1M"].map(strongTotal) } }, gate("insufficient", 33)));
    const { container } = render(<ForecastTrackRecord />);
    await waitFor(() => expect(screen.getByText("实盘证据积累中（SPY 33/60 · QQQ 33/60 · NVDA 33/60）")).toBeInTheDocument());
    expect(container.textContent).not.toContain("各核心资产均已达到既定证据门槛");
  });
});
