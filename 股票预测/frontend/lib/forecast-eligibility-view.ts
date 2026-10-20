import type { LedgerRecord, LedgerStat } from "./types";

// Display helpers for the frozen-close-v1 timing contract (see docs/forecast-time-phase1-2026-10-19.md).
// Only "counted" records feed live accuracy; every other record stays visible with its reason.
export type RecordState = "counted" | "excluded" | "awaiting" | "unconfirmed";

export const QUALIFIED_SAMPLE_GOAL = 20;

const VERIFIED_FIELD: Record<string, string> = { "1D": "Verified", "5D": "Verified_5D", "10D": "Verified_10D", "1M": "Verified_1M" };

const REASONS: Record<string, [string, string]> = {
  published_after_target_open: ["生成或冻结晚于目标交易日开盘", "Generated or frozen after the target session opened"],
  base_session_unclosed: ["基准交易日尚未收盘", "Base session had not closed"],
  source_close_unconfirmed: ["行情取数早于收盘确认时点", "Market data was fetched before the close was confirmed"],
  unsupported_market_calendar: ["该市场的交易日历尚未核验", "This market's trading calendar is not reviewed"],
  calendar_unavailable: ["交易日历未覆盖该日期", "The trading calendar does not cover this date"],
  generation_time_missing: ["缺少生成时间", "Generation time is missing"],
  legacy_snapshot_missing: ["历史记录缺少冻结证据", "Legacy record has no freeze evidence"],
  snapshot_time_missing: ["冻结时间证据不完整", "Freeze timing evidence is incomplete"],
  snapshot_identity_mismatch: ["冻结快照与记录不一致", "Freeze snapshot does not match the record"],
  target_sessions_mismatch: ["目标交易日与快照不一致", "Target sessions do not match the snapshot"],
  price_provenance_missing: ["基准价格来源不完整", "Base price provenance is incomplete"],
  snapshot_time_order_invalid: ["冻结时间顺序异常", "Freeze timestamps are out of order"],
  awaiting_target_close: ["等待目标交易日收盘", "Waiting for the target session to close"],
  timing_not_qualified: ["时间资格未通过", "Timing did not qualify"],
  target_data_missing: ["目标交易日行情缺失", "Target session data is missing"],
  target_data_unconfirmed: ["目标交易日行情尚未确认", "Target session data is not confirmed yet"],
  price_provenance_mismatch: ["结算行情来源或口径不一致", "Settlement data source or basis differs"],
  base_price_revised: ["基准价格被改写（如拆股）", "Base price was revised (for example a split)"],
  target_price_invalid: ["目标价格无效", "Target price is invalid"],
  outcome_evidence_missing: ["缺少结算证据", "Settlement evidence is missing"],
};

type Qualification = { status?: string; reason?: string };

function objectField(row: LedgerRecord, key: string): Record<string, unknown> | null {
  const value = row[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function qualification(row: LedgerRecord, horizon: string): Qualification | null {
  const entry = objectField(row, "Time_Eligibility")?.[horizon];
  return entry && typeof entry === "object" ? entry as Qualification : null;
}

export function recordState(row: LedgerRecord, horizon: string): RecordState {
  const actual = row[horizon === "1D" ? "Actual_1D_Return" : `Actual_${horizon}_Return`];
  const observedFlag = objectField(row, "Outcome_Observed")?.[horizon];
  const observed = typeof observedFlag === "boolean" ? observedFlag : typeof actual === "number";
  if (row[VERIFIED_FIELD[horizon] || "Verified"] === true) return "counted";
  const status = qualification(row, horizon)?.status;
  // Responses from before the timing contract carry no Time_Eligibility: nothing can be counted.
  if (!status) return observed ? "excluded" : "unconfirmed";
  if (observed || status === "ineligible") return "excluded";
  return status === "eligible" ? "awaiting" : "unconfirmed";
}

export function stateReasonCode(row: LedgerRecord, horizon: string): string | null {
  const state = recordState(row, horizon);
  if (state === "counted") return null;
  if (state === "awaiting") {
    const settlement = objectField(row, "Settlement_Status")?.[horizon];
    return typeof settlement === "string" && settlement !== "settled" ? settlement : "awaiting_target_close";
  }
  const timing = qualification(row, horizon);
  if (timing?.status === "eligible") {
    // Timing passed but the outcome lacks frozen settlement evidence.
    const settlement = objectField(row, "Settlement_Status")?.[horizon];
    return typeof settlement === "string" && settlement !== "settled" ? settlement : "outcome_evidence_missing";
  }
  return timing?.reason || "legacy_snapshot_missing";
}

export function reasonLabel(code: string | null, zh: boolean): string {
  if (!code) return "";
  return REASONS[code]?.[zh ? 0 : 1] || code;
}

export function stateLabel(state: RecordState, zh: boolean): string {
  return ({
    counted: zh ? "已计入" : "Counted",
    excluded: zh ? "不计入" : "Not counted",
    awaiting: zh ? "等待结果" : "Awaiting outcome",
    unconfirmed: zh ? "资格未确认" : "Eligibility unconfirmed",
  } satisfies Record<RecordState, string>)[state];
}

// Most common reasons among records that do not count, for one horizon.
export function reasonBreakdown(records: LedgerRecord[], horizon: string, limit = 3): { code: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of records) {
    const state = recordState(row, horizon);
    if (state === "counted" || state === "awaiting") continue;
    const code = stateReasonCode(row, horizon) || "legacy_snapshot_missing";
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  return [...counts].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count).slice(0, limit);
}

export type EligibilityCounts = { observed: number | null; eligible: number | null; ineligible: number | null; unknown: number | null; excluded: number | null };

export function eligibilityCounts(stat: LedgerStat | undefined): EligibilityCounts {
  const pick = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  return { observed: pick(stat?.observed), eligible: pick(stat?.eligible), ineligible: pick(stat?.ineligible), unknown: pick(stat?.unknown), excluded: pick(stat?.excluded) };
}

// A metric is only shown as a signed value once qualified samples exist; otherwise "—" with no color.
export function edgeClass(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value > 0 ? "positive" : "negative" : "";
}
