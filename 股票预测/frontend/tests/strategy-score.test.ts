import { describe, expect, it } from "vitest";
import { followingSessions } from "../netlify/functions/_shared/forecast-eligibility";
import { lastConfirmedSession, scoreStrategies, type ScoredSignal } from "../netlify/functions/_shared/strategy-score";

// Sessions from 2026-03-02 with closes 100 → 110 → 99 → 108.9 (+10%, −10%, +10%).
const days: string[] = ["2026-03-02"];
while (days.length < 6) days.push(followingSessions(days[days.length - 1], 1)[0]);
const closes = new Map([[days[0], 100], [days[1], 110], [days[2], 99], [days[3], 108.9], [days[4], 108.9], [days[5], 108.9]]);
const live = { source: "live" as const, includeActionable: true, minimumSamples: 60 };
const by = (result: ReturnType<typeof scoreStrategies>, key: string) => result.strategies.find((item) => item.key === key)!;

describe("hypothetical close-to-close strategy scoring", () => {
  it("pairs each base's signal with its target-session return, never the base day's own return", () => {
    // Up on day0 (target day1 +10%), Down on day1 (target day2 −10%): long/short gains both days.
    const signals: ScoredSignal[] = [{ base: days[0], forecast: .01 }, { base: days[1], forecast: -.01 }];
    const result = scoreStrategies(signals, closes, live);
    expect([result.status, result.start_target, result.end_target, result.days]).toEqual(["ok", days[1], days[2], 2]);
    expect(by(result, "long_short").return_gross).toBeCloseTo(1.1 * 1.1 - 1, 12);
    expect(by(result, "buy_hold").return_gross).toBeCloseTo(1.1 * .9 - 1, 12);
    expect(by(result, "long_only").return_gross).toBeCloseTo(.1, 12); // long day1, cash day2
  });

  it("charges cost per unit of turnover: 5bps in, 10bps on a flip, 5bps out, and from an initial flat position", () => {
    const signals: ScoredSignal[] = [{ base: days[0], forecast: .01 }, { base: days[1], forecast: -.01 }];
    const result = scoreStrategies(signals, closes, live);
    const ls = by(result, "long_short");
    expect(ls.trades).toBe(2);
    expect(ls.return_net).toBeCloseTo((1 + .1 - .0005) * (1 + .1 - .001) - 1, 12);
    expect(ls.return_after_exit).toBeCloseTo((ls.return_net + 1) * (1 - .0005) - 1, 12);
    // Long-only exits to cash on day 2 and pays the exit cost then.
    expect(by(result, "long_only").return_net).toBeCloseTo((1 + .1 - .0005) * (1 - .0005) - 1, 12);
    // Buy and hold pays a single entry cost.
    expect(by(result, "buy_hold").return_net).toBeCloseTo((1 + .1 - .0005) * (1 - .1) - 1, 12);
  });

  it("keeps missing-signal days in the series as flat for signal strategies, while the benchmark holds", () => {
    const signals: ScoredSignal[] = [{ base: days[0], forecast: .01 }, { base: days[2], forecast: .01 }];
    const result = scoreStrategies(signals, closes, live);
    expect([result.days, result.signal_days, result.missing_signal_days]).toEqual([3, 2, 1]);
    expect(by(result, "buy_hold").return_gross).toBeCloseTo(1.1 * .9 * 1.1 - 1, 12);
    expect(by(result, "long_only").return_gross).toBeCloseTo(1.1 * 1.1 - 1, 12);
  });

  it("never treats a missing price as a zero return or skips the day", () => {
    const gap = new Map(closes); gap.delete(days[2]);
    const result = scoreStrategies([{ base: days[0], forecast: .01 }, { base: days[2], forecast: .01 }], gap, live);
    expect(result.status).toBe("incomplete_price");
    expect(result.reason).toBe(`price_missing:${days[2]}`);
    expect(result.strategies).toEqual([]);
  });

  it("includes the initial NAV in drawdown and reports no win rate without holding days", () => {
    const result = scoreStrategies([{ base: days[1], forecast: .01 }], closes, live);
    const longOnly = by(result, "long_only");
    expect(longOnly.max_drawdown_net).toBeCloseTo(1 - (1 - .1 - .0005), 12); // first day loses from NAV 1
    const flat = scoreStrategies([{ base: days[0], forecast: 0 }], closes, live);
    expect([by(flat, "long_only").holding_days, by(flat, "long_only").win_rate]).toEqual([0, null]);
    expect(by(flat, "long_only").max_drawdown_net).toBe(0);
  });

  it("only offers the actionable strategy for live evidence and flags insufficient samples", () => {
    const signals: ScoredSignal[] = [{ base: days[0], forecast: .01, action: "Up" }, { base: days[1], forecast: -.01, action: "Observe" }];
    const result = scoreStrategies(signals, closes, live);
    expect(by(result, "actionable_only").holding_days).toBe(1);
    expect(result.sufficient).toBe(false);
    const backtest = scoreStrategies(signals, closes, { source: "backtest", includeActionable: false, minimumSamples: 1 });
    expect(backtest.strategies.map((item) => item.key)).toEqual(["buy_hold", "long_only", "long_short"]);
    expect(backtest.sufficient).toBe(true);
    expect(scoreStrategies([], closes, live).status).toBe("no_data");
  });

  it("confirms a session only when the history fetch is at least 15 minutes after its close, early closes included", () => {
    expect(lastConfirmedSession("2026-10-23T15:00:00Z")).toBe("2026-10-22"); // 11:00 ET, intraday
    expect(lastConfirmedSession("2026-10-23T20:14:59Z")).toBe("2026-10-22");
    expect(lastConfirmedSession("2026-10-23T20:15:00Z")).toBe("2026-10-23");
    expect(lastConfirmedSession("2026-10-25T12:00:00Z")).toBe("2026-10-23"); // Sunday
    expect(lastConfirmedSession("2026-11-27T18:10:00Z")).toBe("2026-11-25"); // early close 13:00 EST, Thanksgiving before
    expect(lastConfirmedSession("2026-11-27T18:15:00Z")).toBe("2026-11-27");
    expect(lastConfirmedSession(undefined)).toBeNull();
  });

  it("leaves an unconfirmed tail out instead of scoring a last price, and stops on interior gaps", () => {
    const signals: ScoredSignal[] = [{ base: days[0], forecast: .01 }, { base: days[1], forecast: .01 }, { base: days[2], forecast: .01 }];
    const cut = scoreStrategies(signals, closes, { ...live, confirmedThrough: days[2] });
    expect([cut.status, cut.end_target, cut.signal_days]).toEqual(["ok", days[2], 2]);
    expect(scoreStrategies(signals, closes, { ...live, confirmedThrough: null })).toMatchObject({ status: "no_data", reason: "close_unconfirmed" });
    const gap = new Map(closes); gap.delete(days[1]);
    expect(scoreStrategies(signals, gap, { ...live, confirmedThrough: days[3] }).status).toBe("incomplete_price");
  });

  it("leaves out bases outside the reviewed calendar instead of guessing sessions", () => {
    const result = scoreStrategies([{ base: "2025-06-02", forecast: .01 }, { base: days[0], forecast: .01 }], closes, live);
    expect([result.start_target, result.signal_days]).toEqual([days[1], 1]);
  });
});
