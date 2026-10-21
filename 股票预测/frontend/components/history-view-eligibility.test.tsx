import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Forecast, LedgerStat, Performance, PredictionHistory, PredictionLedgerSection } from "@/lib/types";
import { ForecastEvolution, HistoryView, PerformanceView } from "./detail-panel";

const app = vi.hoisted(() => ({ language: "zh", t: (key: string) => key }));
const charts = vi.hoisted(() => [] as Array<{ rows: Record<string, unknown>[] }>);
vi.mock("./providers", () => ({ useApp: () => app }));
vi.mock("./unified-line-chart", () => ({ UnifiedLineChart: (props: { rows: Record<string, unknown>[] }) => { charts.push(props); return null; } }));

afterEach(() => { cleanup(); charts.length = 0; });

const stat = (extra: Partial<LedgerStat> = {}): LedgerStat => ({ window: "All", completed: 50, pending: 0, hit_count: 30, miss_count: 20, direction_accuracy: 60, majority_baseline_accuracy: 52, direction_edge: 8, ...extra });
const rolling = [{ As_Of_Date: "2026-09-01", Rolling_Accuracy_20: 60, Cumulative_Accuracy: 60 }];
function section(statistics: LedgerStat[], records: PredictionLedgerSection["records"] = []): PredictionLedgerSection {
  return { symbol: "SPY", notice: "", statistics, records, charts: { rolling_accuracy: rolling, scatter: [], timeline: [], errors: [] } };
}
// Old-shaped history: no protocol, Verified=true only meant "has an outcome".
const oldRecord = { As_Of_Date: "2026-09-10", Best_Model: "Orivane Horizon Router", Forecast_1D_Return: 0.01, Actual_1D_Return: 0.02, Raw_Direction_Correct: 1, Verified: true };
const old = section([stat()], [oldRecord]);
const history = (live: PredictionLedgerSection, backtest = section([stat({ completed: 360 })])): PredictionHistory =>
  ({ ...live, backtest, live, legacy: section([stat()]) });

describe("asset prediction history under the timing contract", () => {
  it("does not chart or count an old-shaped live section", () => {
    const { container } = render(<HistoryView predictions={history(old)} />);
    expect(charts).toEqual([]);
    expect(screen.getByText("该来源的统计口径未确认，暂不展示成绩。")).toBeInTheDocument();
    expect(container.querySelector(".history-stat-strip strong")!.textContent).toBe("—");
    expect(container.querySelector("tbody .record-state")!.textContent).toBe("不计入");
  });

  it("shows a protocol-confirmed zero as 0", () => {
    const confirmed = { ...section([stat({ protocol: "frozen-close-v1", completed: 0, direction_accuracy: null, direction_edge: null })]), charts: { rolling_accuracy: [], scatter: [], timeline: [], errors: [] } };
    const { container } = render(<HistoryView predictions={history(confirmed)} />);
    expect(container.querySelector(".history-stat-strip strong")!.textContent).toBe("0");
    expect(screen.getByText("该来源暂时没有已完成验证的样本。")).toBeInTheDocument();
  });

  it("keeps the walk-forward backtest chart on its own basis", () => {
    render(<HistoryView predictions={history(old)} />);
    fireEvent.click(screen.getByRole("tab", { name: /走步回测/ }));
    expect(charts.at(-1)!.rows).toEqual(rolling);
  });

  it("shows one change-log row per base date and compares against the prior date", () => {
    const timing = (status: string, reason: string) => ({ "1D": { status, reason, protocol: "frozen-close-v1" } });
    const records = [
      { As_Of_Date: "2026-10-20", Best_Model: "ARIMA", Forecast_1D_Return: 0.001, Time_Eligibility: timing("ineligible", "base_session_unclosed") },
      { As_Of_Date: "2026-10-20", Best_Model: "ARIMA", Forecast_1D_Return: 0.004, Time_Eligibility: timing("eligible", "qualified") },
      { As_Of_Date: "2026-10-19", Best_Model: "ARIMA", Forecast_1D_Return: 0.002, Time_Eligibility: timing("ineligible", "published_after_target_open") },
    ];
    const { container } = render(<ForecastEvolution forecast={{ best_model: "ARIMA" } as unknown as Forecast} predictions={history(section([], records))} />);
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll("td")[2].textContent).toBe("+0.40%");
    expect(rows[0].querySelector(".record-state-reason")!.textContent).toBe("同日另有 1 条记录：基准交易日尚未收盘");
    expect(rows[1].querySelector(".record-state-reason")).toBeNull();
    // 0.40% vs the 10-19 call (0.20%), not vs the same-day intraday row.
    expect(container.querySelector("header b")!.textContent).toBe("较上次 +0.20%");
  });

  it("shows unknown live performance counts as —", () => {
    const performance = { backtest: { best: {}, models: [], test_samples: 0, horizon_statistics: [] }, live_predictions: { statistics: [stat()], notice: "" } } as unknown as Performance;
    const { container } = render(<PerformanceView performance={performance} />);
    const values = Object.fromEntries([...container.querySelectorAll(".metric-list div")].map((row) => [row.querySelector("dt")!.textContent, row.querySelector("dd")!.textContent]));
    expect([values.completed, values.pending]).toEqual(["—", "—"]);
  });
});
