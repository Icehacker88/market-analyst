import { describe, expect, it } from "vitest";
import { edgeClass, eligibilityCounts, reasonBreakdown, reasonLabel, recordState, stateReasonCode } from "./forecast-eligibility-view";

const timing = (status: string, reason: string) => ({ "1D": { status, reason, protocol: "frozen-close-v1" }, "5D": { status, reason, protocol: "frozen-close-v1" } });

describe("frozen forecast eligibility view", () => {
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
});
