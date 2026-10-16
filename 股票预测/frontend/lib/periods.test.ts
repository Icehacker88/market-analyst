import { describe, expect, it } from "vitest";
import { LONG_HISTORY_RANGES } from "./history-series";
import { fillMissingPeriodReturns, periodReturn, periodReturnsFromHistory, recentRangesWithin } from "./periods";
import { startForRange } from "./selection";
import type { History, HistoryRecord } from "./types";

const records = Array.from({ length: 8 }, (_, index) => ({
  Date: `2026-06-${String(index + 1).padStart(2, "0")}`,
  Price: 100 + index * 10,
})) as HistoryRecord[];

describe("period returns", () => {
  it("uses trading sessions for short ranges", () => {
    expect(periodReturn(records, "1D")).toBeCloseTo(170 / 160 - 1);
    expect(periodReturn(records, "5D")).toBeCloseTo(170 / 120 - 1);
  });

  it("uses the first available point for all time", () => {
    expect(periodReturn(records, "MAX")).toBeCloseTo(0.7);
  });

  it("ignores invalid non-positive prices in long history", () => {
    expect(periodReturn([
      { Date: "1999-01-01", Price: -0.4 },
      { Date: "2000-01-01", Price: 10 },
      { Date: "2026-01-01", Price: 40 },
    ], "MAX")).toBeCloseTo(3);
  });
});

// Shape of a full-history (1900-01-01) response: monthly bars whose last bar already
// carries the latest close, followed by the latest session (NVDA on 2026-10-15).
const monthlyHistory: History = {
  symbol: "NVDA",
  data_source: "yahoo",
  data_as_of: "2026-10-15",
  snapshot: {},
  records: [
    { Date: "2016-10-01", Price: 2.2 },
    { Date: "2021-10-01", Price: 32.2 },
    { Date: "2026-05-01", Price: 210.6584930419922 },
    { Date: "2026-06-01", Price: 199.86634826660156 },
    { Date: "2026-07-01", Price: 200.52561950683594 },
    { Date: "2026-08-01", Price: 220.53323364257812 },
    { Date: "2026-09-01", Price: 228.3800048828125 },
    { Date: "2026-10-01", Price: 217.22999572753906 },
    { Date: "2026-10-15", Price: 217.22999572753906 },
  ] as HistoryRecord[],
};

describe("period returns from loaded histories", () => {
  it("takes only long ranges from monthly full history", () => {
    const result = periodReturnsFromHistory(monthlyHistory, LONG_HISTORY_RANGES, true);
    expect(Object.keys(result.returns)).toEqual(["5Y", "10Y", "MAX"]);
    expect(result.long_term_complete).toBe(true);
    expect(result.returns.MAX).toBeCloseTo(217.22999572753906 / 2.2 - 1);
  });

  it("would mislabel monthly bars as short sessions, which is why they are excluded", () => {
    // The bug this guards against: 1D compared two equal bars and 5D reached back five months.
    expect(periodReturn(monthlyHistory.records, "1D")).toBe(0);
    expect(periodReturn(monthlyHistory.records, "5D")).toBeCloseTo(217.22999572753906 / 199.86634826660156 - 1);
  });

  it("only computes recent ranges the daily window covers", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    expect(recentRangesWithin(startForRange("1Y", now), now)).toEqual(["1D", "5D", "1M", "6M", "YTD", "1Y"]);
    expect(recentRangesWithin(startForRange("1M", now), now)).toEqual(["1D", "5D", "1M"]);
    expect(recentRangesWithin(startForRange("1D", now), now)).toEqual(["1D"]);
  });

  it("keeps year-to-date inside a one-month window early in January", () => {
    const now = new Date("2026-01-10T12:00:00Z");
    expect(recentRangesWithin(startForRange("1M", now), now)).toEqual(["1D", "5D", "1M", "YTD"]);
  });
});

describe("filling missing period returns", () => {
  it("adds absent or null ranges without replacing shown values", () => {
    const shown = { symbol: "NVDA", data_as_of: "2026-10-16", returns: { "1D": 0.1, "6M": null } };
    const cached = { symbol: "NVDA", data_as_of: "2026-10-15", long_term_complete: true, returns: { "1D": -0.02, "6M": 0.3, "5Y": 2 } };
    expect(fillMissingPeriodReturns(shown, cached)).toEqual({
      symbol: "NVDA",
      data_as_of: "2026-10-16",
      long_term_complete: true,
      returns: { "1D": 0.1, "6M": 0.3, "5Y": 2 },
    });
  });
});
