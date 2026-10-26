import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ForecastScoreAsset, StrategyComparison } from "@/lib/types";
import { StrategyComparisonSection } from "./strategy-comparison";

afterEach(cleanup);

const base = (extra: Partial<StrategyComparison>): StrategyComparison => ({ rule: "hypothetical-close-to-close-v1", source: "live", basis: "Close", cost_bps: 5, status: "ok", reason: null,
  start_target: "2026-06-01", end_target: "2026-10-23", days: 100, signal_days: 98, missing_signal_days: 2, minimum_samples: 60, sufficient: true, strategies: [], ...extra });
const row = (key: StrategyComparison["strategies"][number]["key"], net: number, extra = {}) => ({ key, return_net: net, return_gross: net + .01, return_after_exit: net - .0005, excess_vs_hold_net: net - .05, trades: 10, holding_days: 50, win_rate: 52.4, max_drawdown_net: .08, ...extra });
const asset = (symbol: string, live: StrategyComparison, backtest: StrategyComparison): ForecastScoreAsset => ({ symbol, data_as_of: "2026-10-23", backtest: { statistics: [], horizon_statistics: [] }, live: { statistics: [], horizon_statistics: [] }, strategy: { live, backtest } });

describe("StrategyComparisonSection", () => {
  it("labels the score as hypothetical, shows live no-data, and switches to the backtest table", () => {
    const backtest = base({ source: "backtest", days: 40, signal_days: 40, missing_signal_days: 0, sufficient: false, strategies: [row("buy_hold", .05), row("long_only", .02), row("long_short", -.03, { win_rate: null, holding_days: 0 })] });
    render(<StrategyComparisonSection zh assets={[asset("SPY", base({ status: "no_data", strategies: [] }), backtest)]} />);
    expect(screen.getByText("假设性收盘价评分（非真实交易收益）")).toBeInTheDocument();
    expect(screen.getByText("暂无当前预测政策版本的已结算合格样本。")).toBeInTheDocument();
    expect(screen.getByText(/不是可执行收益/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "走步回测（模拟）" }));
    const rows = screen.getAllByRole("row").slice(1).map((tr) => [...tr.querySelectorAll("td")].map((td) => td.firstChild?.textContent));
    expect(rows.map((cells) => cells[0])).toEqual(["一直持有（基准）", "只做多：预测上涨时持有", "按方向多空"]);
    expect(rows[1][1]).toBe("+2.00%");
    expect(rows[0][2]).toBe("—");
    expect(rows[2][4]).toBe("无持仓");
    expect(rows[2][5]).toBe("-8.00%");
    expect(screen.getByRole("note").textContent).toContain("样本不足（40/60），不能作为结论");
  });

  it("refuses to score a window with a missing close and switches assets", () => {
    render(<StrategyComparisonSection zh assets={[
      asset("SPY", base({ status: "incomplete_price", reason: "price_missing:2026-10-21", strategies: [] }), base({ source: "backtest" })),
      asset("QQQ", base({ strategies: [row("buy_hold", .1), row("actionable_only", 0, { trades: 0, holding_days: 0, win_rate: null })] }), base({ source: "backtest" })),
    ]} />);
    expect(screen.getByText(/区间内缺少收盘价（2026-10-21）/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "资产" }), { target: { value: "QQQ" } });
    expect(screen.getByText("只按实盘可操作信号")).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("renders nothing when no asset carries a strategy comparison (older response)", () => {
    const { container } = render(<StrategyComparisonSection zh assets={[{ ...asset("SPY", base({}), base({})), strategy: null }]} />);
    expect(container.innerHTML).toBe("");
  });
});
