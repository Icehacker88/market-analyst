import { FORECAST_POLICY_VERSION } from "./forecast-policy";
import type { EvidenceGate, Forecast, LedgerRecord, LedgerStat } from "./types";

// Display helpers for the frozen-close-v1 timing contract (see docs/forecast-time-phase1-2026-10-19.md).
// Only "counted" records feed live accuracy; every other record stays visible with its reason.
export type RecordState = "counted" | "excluded" | "awaiting" | "unconfirmed";

// Per-asset evidence gate (user-confirmed 2026-10-24): current policy version only.
export const QUALIFIED_SAMPLE_GOAL = 60;
export const SUPPORTED_PROTOCOL = "frozen-close-v1";

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
  protocol_unconfirmed: ["统计口径未确认（可能是旧版缓存）", "Scoring protocol unconfirmed (possibly an old cached response)"],
  policy_version_other: ["非当前预测政策版本，不计入当前证据", "Generated under another forecast policy version; not counted as current evidence"],
};

type Qualification = { status?: string; reason?: string };

function objectField(row: LedgerRecord, key: string): Record<string, unknown> | null {
  const value = row[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

// Only a supported protocol's per-horizon verdict is trusted; anything else is unconfirmed.
export function qualification(row: LedgerRecord, horizon: string): Qualification | null {
  const entry = objectField(row, "Time_Eligibility")?.[horizon] as (Qualification & { protocol?: string }) | undefined;
  return entry && typeof entry === "object" && entry.protocol === SUPPORTED_PROTOCOL ? entry : null;
}

export function recordState(row: LedgerRecord, horizon: string): RecordState {
  const actual = row[horizon === "1D" ? "Actual_1D_Return" : `Actual_${horizon}_Return`];
  const observedFlag = objectField(row, "Outcome_Observed")?.[horizon];
  const observed = typeof observedFlag === "boolean" ? observedFlag : typeof actual === "number";
  const status = qualification(row, horizon)?.status;
  // Old responses used Verified=true for "has an outcome"; without the contract nothing counts.
  if (!status) return observed ? "excluded" : "unconfirmed";
  // Timing may qualify, but only the current policy version's outcomes are evidence.
  if (status === "eligible" && row.Policy_Current === false) return "excluded";
  if (status === "eligible" && row[VERIFIED_FIELD[horizon] || "Verified"] === true) return "counted";
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
  if (!timing) return "protocol_unconfirmed";
  if (timing.status === "eligible" && row.Policy_Current === false) return "policy_version_other";
  if (timing.status === "eligible") {
    // Timing passed but the outcome lacks frozen settlement evidence.
    const settlement = objectField(row, "Settlement_Status")?.[horizon];
    return typeof settlement === "string" && settlement !== "settled" ? settlement : "outcome_evidence_missing";
  }
  return timing.reason || "legacy_snapshot_missing";
}

// One entry per base date for change logs. A base date can hold two rows: the cloud
// keeps the first (often intraday) record and appends the first timing-eligible
// publication after the close. Show the eligible row; keep the others as context.
export function onePerBaseDate(records: LedgerRecord[]): { row: LedgerRecord; others: LedgerRecord[] }[] {
  const groups = new Map<string, LedgerRecord[]>();
  records.forEach((row, index) => {
    const day = String(row.As_Of_Date || "").slice(0, 10) || `#${index}`;
    const group = groups.get(day);
    if (group) group.push(row);
    else groups.set(day, [row]);
  });
  return [...groups.values()].map((rows) => {
    const chosen = Math.max(0, rows.findIndex((row) => qualification(row, "1D")?.status === "eligible"));
    return { row: rows[chosen], others: rows.filter((_, index) => index !== chosen) };
  });
}

// "58.0%（95% 区间 41.2–73.6%）"; just the point estimate when no interval is known.
export function accuracyWithInterval(stat: Pick<LedgerStat, "direction_accuracy" | "direction_accuracy_ci_low" | "direction_accuracy_ci_high"> | undefined, zh: boolean): string {
  const value = stat?.direction_accuracy;
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const low = stat?.direction_accuracy_ci_low, high = stat?.direction_accuracy_ci_high;
  const point = `${value.toFixed(1)}%`;
  if (typeof low !== "number" || typeof high !== "number") return point;
  return zh ? `${point}（95% 区间 ${low.toFixed(1)}–${high.toFixed(1)}%）` : `${point} (95% interval ${low.toFixed(1)}–${high.toFixed(1)}%)`;
}

// Gates are judged per asset against the full expected core set: a missing asset, a duplicate or a
// missing gate leaves the verdict unknown, and a cross-asset total never stands in for one asset.
export function gateSummary(expected: string[], assets: Array<{ symbol: string; gate?: EvidenceGate | null }>, zh = true): { known: boolean; allMet: boolean; anyNotMet: boolean; missing: string[]; progress: string } {
  const symbols = [...new Set(expected.map((symbol) => symbol.toUpperCase()))];
  const lookup = symbols.map((symbol) => {
    const matches = assets.filter((item) => item.symbol.toUpperCase() === symbol);
    // A gate from another policy version (e.g. a cached older response) counts as missing.
    const gate = matches.length === 1 ? matches[0].gate ?? null : null;
    return { symbol, gate: gate && gate.policy_version === FORECAST_POLICY_VERSION ? gate : null };
  });
  const missing = lookup.filter((item) => !item.gate).map((item) => item.symbol);
  const known = symbols.length > 0 && missing.length === 0;
  return {
    known,
    allMet: known && lookup.every((item) => item.gate!.status === "met"),
    anyNotMet: lookup.some((item) => item.gate?.status === "not_met"),
    missing,
    progress: lookup.map((item) => item.gate
      ? `${item.symbol} ${Math.min(item.gate.samples, item.gate.required)}/${item.gate.required}`
      : `${item.symbol} ${zh ? "数据缺失" : "data missing"}`).join(" · "),
  };
}

export function isCounted(row: LedgerRecord, horizon: string): boolean {
  return recordState(row, horizon) === "counted";
}

// Live statistics count as qualified evidence only when scored under the supported protocol and
// the current forecast policy; anything else (e.g. a cached older response) is unconfirmed.
export function isQualifiedStat(stat: LedgerStat | undefined): stat is LedgerStat {
  return stat?.protocol === SUPPORTED_PROTOCOL && stat.policy_version === FORECAST_POLICY_VERSION;
}

export function qualifiedStats(stats: LedgerStat[] | undefined): LedgerStat[] {
  return (stats || []).filter(isQualifiedStat);
}

// A forecast's live evidence is trusted only if the forecast itself was produced under the
// contract (it then carries evaluation_snapshot); older cached forecasts used contaminated counts.
export function forecastLiveEvidence(forecast: Forecast): NonNullable<Forecast["validation"]>["live"] | null {
  return forecast.evaluation_snapshot?.schema_version === SUPPORTED_PROTOCOL && forecast.policy_version === FORECAST_POLICY_VERSION
    ? forecast.validation?.live ?? null : null;
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
