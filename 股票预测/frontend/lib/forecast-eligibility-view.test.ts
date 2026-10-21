import { describe, expect, it } from "vitest";
import { edgeClass, eligibilityCounts, forecastLiveEvidence, isQualifiedStat, onePerBaseDate, reasonBreakdown, reasonLabel, recordState, stateReasonCode } from "./forecast-eligibility-view";
import type { Forecast } from "./types";

const timing = (status: string, reason: string) => ({ "1D": { status, reason, protocol: "frozen-close-v1" }, "5D": { status, reason, protocol: "frozen-close-v1" } });

describe("frozen forecast eligibility view", () => {
  it("shows one change-log entry per base date, preferring the eligible same-day row", () => {
    const intraday = { As_Of_Date: "2026-10-20", Publication_ID: "intraday", Time_Eligibility: timing("ineligible", "base_session_unclosed") };
    const closed = { As_Of_Date: "2026-10-20", Publication_ID: "closed", Time_Eligibility: timing("eligible", "qualified") };
    const prior = { As_Of_Date: "2026-10-19", Publication_ID: "prior", Time_Eligibility: timing("unknown", "legacy_snapshot_missing") };
    const entries = onePerBaseDate([intraday, closed, prior]);
    expect(entries.map((entry) => entry.row.Publication_ID)).toEqual(["closed", "prior"]);
    expect(entries[0].others).toEqual([intraday]);
    expect(reasonLabel(stateReasonCode(entries[0].others[0], "1D"), true)).toBe("基准交易日尚未收盘");
    expect(entries[1].others).toEqual([]);
    // Order within a date does not matter; without an eligible row the first is kept.
    expect(onePerBaseDate([closed, intraday])[0].row).toBe(closed);
    const second = { ...intraday, Publication_ID: "second" };
    expect(onePerBaseDate([intraday, second]).map((entry) => [entry.row.Publication_ID, entry.others.length])).toEqual([["intraday", 1]]);
    // Rows without a date never merge with each other.
    expect(onePerBaseDate([{ Publication_ID: "a" }, { Publication_ID: "b" }])).toHaveLength(2);
    // Timestamped dates group by the calendar day.
    expect(onePerBaseDate([{ ...closed, As_Of_Date: "2026-10-20T20:16:00Z" }, intraday])).toHaveLength(1);
  });

  it("counts only verified records and keeps every other outcome visible with a reason", () => {
    const counted = { Verified: true, Actual_1D_Return: 0.01, Time_Eligibility: timing("eligible", "qualified"), Outcome_Observed: { "1D": true } };
    const late = { Verified: false, Actual_1D_Return: 0.01, Time_Eligibility: timing("ineligible", "published_after_target_open"), Outcome_Observed: { "1D": true } };
    const legacy = { Verified: false, Actual_1D_Return: -0.02, Time_Eligibility: timing("unknown", "legacy_snapshot_missing"), Outcome_Observed: { "1D": true } };
    const awaiting = { Verified: false, Time_Eligibility: timing("eligible", "qualified"), Outcome_Observed: { "1D": false }, Settlement_Status: { "1D": "awaiting_target_close" } };
    const unconfirmed = { Verified: false, Time_Eligibility: timing("unknown", "unsupported_market_calendar"), Outcome_Observed: { "1D": false } };
    expect([counted, late, legacy, awaiting, unconfirmed].map((row) => recordState(row, "1D"))).toEqual(["counted", "excluded", "excluded", "awaiting", "unconfirmed"]);
    expect(stateReasonCode(counted, "1D")).toBeNull();
    expect(reasonLabel(stateReasonCode(late, "1D"), true)).toBe("生成或冻结晚于目标交易日开盘");
    expect(reasonLabel(stateReasonCode(awaiting, "1D"), true)).toBe("等待目标交易日收盘");
    expect(reasonLabel(stateReasonCode(unconfirmed, "1D"), false)).toBe("This market's trading calendar is not reviewed");
  });

  it("never counts a response without the timing contract, and explains settled-but-unproven outcomes", () => {
    expect(recordState({ Actual_1D_Return: 0.01 }, "1D")).toBe("excluded");
    expect(recordState({}, "1D")).toBe("unconfirmed");
    // Old responses used Verified=true for "has an outcome"; that must not count.
    const oldCached = { Verified: true, Actual_1D_Return: 0.01 };
    expect(recordState(oldCached, "1D")).toBe("excluded");
    expect(reasonLabel(stateReasonCode(oldCached, "1D"), true)).toBe("统计口径未确认（可能是旧版缓存）");
    const otherProtocol = { Verified: true, Actual_1D_Return: 0.01, Time_Eligibility: { "1D": { status: "eligible", reason: "qualified", protocol: "frozen-close-v0" } } };
    expect(recordState(otherProtocol, "1D")).toBe("excluded");
    const ineligibleButVerified = { Verified: true, Actual_1D_Return: 0.01, Time_Eligibility: timing("ineligible", "published_after_target_open") };
    expect(recordState(ineligibleButVerified, "1D")).toBe("excluded");
    const unproven = { Verified: false, Actual_1D_Return: 0.01, Time_Eligibility: timing("eligible", "qualified"), Outcome_Observed: { "1D": true } };
    expect(reasonLabel(stateReasonCode(unproven, "1D"), true)).toBe("缺少结算证据");
  });

  it("uses the per-horizon verified flag", () => {
    const row = { Verified: true, Verified_5D: false, Time_Eligibility: timing("eligible", "qualified"), Outcome_Observed: { "1D": true, "5D": false } };
    expect(recordState(row, "1D")).toBe("counted");
    expect(recordState(row, "5D")).toBe("awaiting");
  });

  it("ranks reasons among records that do not count", () => {
    const rows = [
      { Time_Eligibility: timing("unknown", "legacy_snapshot_missing"), Actual_1D_Return: 0.01 },
      { Time_Eligibility: timing("unknown", "legacy_snapshot_missing"), Actual_1D_Return: 0.02 },
      { Time_Eligibility: timing("ineligible", "published_after_target_open"), Actual_1D_Return: 0.03 },
      { Verified: true, Time_Eligibility: timing("eligible", "qualified"), Actual_1D_Return: 0.01 },
      { Time_Eligibility: timing("eligible", "qualified") },
    ];
    expect(reasonBreakdown(rows, "1D")).toEqual([{ code: "legacy_snapshot_missing", count: 2 }, { code: "published_after_target_open", count: 1 }]);
  });

  it("reads coverage counters as null when absent and leaves missing edges uncolored", () => {
    expect(eligibilityCounts({ window: "All", completed: 0, pending: 0, hit_count: 0, miss_count: 0 })).toEqual({ observed: null, eligible: null, ineligible: null, unknown: null, excluded: null });
    expect(eligibilityCounts({ window: "All", completed: 0, pending: 0, hit_count: 0, miss_count: 0, observed: 49, excluded: 49, eligible: 0, ineligible: 22, unknown: 27 }).excluded).toBe(49);
    expect([edgeClass(null), edgeClass(undefined), edgeClass(2), edgeClass(-1)]).toEqual(["", "", "positive", "negative"]);
  });

  it("trusts live statistics and forecast evidence only under the timing contract", () => {
    const base = { window: "All", completed: 100, pending: 0, hit_count: 60, miss_count: 40, direction_edge: 3 };
    expect(isQualifiedStat(base)).toBe(false);
    expect(isQualifiedStat({ ...base, protocol: "frozen-close-v1" })).toBe(true);
    const live = { samples: 49, direction_accuracy: 44, majority_baseline_accuracy: 54, direction_edge: -10 };
    const forecast = { validation: { live } } as unknown as Forecast;
    expect(forecastLiveEvidence(forecast)).toBeNull();
    expect(forecastLiveEvidence({ ...forecast, evaluation_snapshot: { schema_version: "frozen-close-v1" } } as Forecast)).toEqual(live);
  });
});
