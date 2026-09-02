import { describe, expect, it } from "vitest";
import { forecastTrend } from "./forecast-trend";
import type { LedgerStat } from "./types";

const stat = (window: string, completed: number, edge: number): LedgerStat => ({ window, horizon: "1D", completed, pending: 0, direction_edge: edge, hit_count: 0, miss_count: 0 });

describe("forecast trend", () => {
  it("detects recent deterioration versus the full sample", () => {
    const trend = forecastTrend([stat("20", 20, -25), stat("All", 47, -4.3)]);
    expect(trend.state).toBe("worsening");
    expect(trend.delta).toBeCloseTo(-20.7);
  });

  it("does not infer a trend before a full recent window exists", () => {
    const trend = forecastTrend([stat("20", 14, 7), stat("All", 14, 7)]);
    expect(trend.state).toBe("unavailable");
    expect(trend.delta).toBeNull();
  });
});
