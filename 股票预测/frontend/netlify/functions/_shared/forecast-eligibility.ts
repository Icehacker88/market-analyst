import calendar from "../../../../contracts/us-equity-calendar.json";

export const TIMING_PROTOCOL = "frozen-close-v1";
export const HORIZON_DAYS: Record<string, number> = { "1D": 1, "5D": 5, "10D": 10, "1M": 22 };
type Row = Record<string, unknown>;
export type Qualification = { status: "eligible" | "ineligible" | "unknown"; reason: string; protocol: string };
export type EvaluationSnapshot = {
  schema_version: string; calendar: string | null; symbol: string; base_session: string;
  base_price: number | null; price_basis: string | null; source: string | null;
  source_observed_at: string | null; generated_at: string; frozen_at: string | null; target_sessions: string[];
};
const knownSymbols = new Set(["SPY", "QQQ", "NVDA"]);
export function finitePositive(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value > 0; }
export function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const n = Date.parse(value); return Number.isFinite(n) ? n : null;
}
// Intl uses the runtime's IANA timezone rules; no fixed UTC offset or weekend-only calendar.
function nyTime(day: string, hour: number, minute = 0): number {
  const noon = new Date(`${day}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).formatToParts(noon);
  const offset = Number(parts.find((p) => p.type === "hour")!.value) - 12;
  return Date.parse(`${day}T00:00:00Z`) + ((hour - offset) * 60 + minute) * 60000;
}
const sessionCache = new Map<string, { open: number; close: number } | null>();
export function equitySession(day: string): { open: number; close: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < calendar.first_date || day > calendar.last_date) return null;
  if (sessionCache.has(day)) return sessionCache.get(day)!;
  const d = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== day || [0, 6].includes(d.getUTCDay()) || calendar.holidays.includes(day)) return null;
  const value = Object.freeze({ open: nyTime(day, 9, 30), close: nyTime(day, calendar.early_closes.includes(day) ? 13 : 16) });
  sessionCache.set(day, value);
  return value;
}
const followingCache = new Map<string, readonly string[]>();
export function followingSessions(day: string, count: number): string[] {
  if (!equitySession(day) || !Object.values(HORIZON_DAYS).includes(count)) return [];
  const key = `${day}/${count}`;
  if (followingCache.has(key)) return [...followingCache.get(key)!];
  let cursor = Date.parse(`${day}T00:00:00Z`); const days: string[] = [];
  while (days.length < count) {
    cursor += 86400000; const date = new Date(cursor).toISOString().slice(0, 10);
    if (date > calendar.last_date) return [];
    if (equitySession(date)) days.push(date);
  }
  followingCache.set(key, Object.freeze([...days]));
  return days;
}
export function makeEvaluationSnapshot(asset: { symbol: string; asset_type?: string; exchange?: string | null; currency?: string | null }, base: Row, source: unknown, observed: unknown, generated: string): EvaluationSnapshot {
  const supported = knownSymbols.has(asset.symbol) || (["stock", "etf"].includes(asset.asset_type || "") && asset.currency === "USD" && ["NYSE", "NYSE Arca", "NASDAQ", "NMS", "NGM", "NCM", "NYQ", "PCX", "ASE", "AMEX", "BATS"].includes(asset.exchange || ""));
  const basis = finitePositive(base["Adj Close"]) && base.Price === base["Adj Close"] ? "Adj Close" : !finitePositive(base["Adj Close"]) && finitePositive(base.Close) && base.Price === base.Close ? "Close" : null;
  return { schema_version: TIMING_PROTOCOL, calendar: supported ? calendar.version : null, symbol: asset.symbol, base_session: String(base.Date || ""), base_price: finitePositive(base.Price) ? base.Price : null,
    price_basis: basis, source: typeof source === "string" ? source : null, source_observed_at: typeof observed === "string" ? observed : null,
    generated_at: generated, frozen_at: null, target_sessions: supported ? followingSessions(String(base.Date || ""), 22) : [] };
}
export function qualifyForecast(row: Row, horizon = "1D", now = Date.now()): Qualification {
  const result = (status: Qualification["status"], reason: string): Qualification => ({ status, reason, protocol: TIMING_PROTOCOL });
  const s = row.Evaluation_Snapshot as EvaluationSnapshot | undefined;
  if (!knownSymbols.has(String(row.Ticker)) && s?.calendar !== calendar.version) return result("unknown", "unsupported_market_calendar");
  const base = String(row.As_Of_Date || ""), times = equitySession(base), targets = followingSessions(base, HORIZON_DAYS[horizon]);
  if (!times || !targets.length) return result("unknown", "calendar_unavailable");
  const generated = timestamp(row.Created_At);
  if (generated === null) return result("unknown", "generation_time_missing");
  const open = equitySession(targets[0])!.open;
  if (generated < times.close) return result("ineligible", "base_session_unclosed");
  if (generated >= open) return result("ineligible", "published_after_target_open");
  if (s?.schema_version !== TIMING_PROTOCOL) return result("unknown", "legacy_snapshot_missing");
  if (s.symbol !== row.Ticker || s.base_session !== base || s.calendar !== calendar.version) return result("unknown", "snapshot_identity_mismatch");
  if (JSON.stringify(Array.isArray(s.target_sessions) ? s.target_sessions.slice(0, targets.length) : null) !== JSON.stringify(targets)) return result("unknown", "target_sessions_mismatch");
  if (!finitePositive(s.base_price) || !["Adj Close", "Close"].includes(s.price_basis || "") || !s.source) return result("unknown", "price_provenance_missing");
  const observed = timestamp(s.source_observed_at), frozen = timestamp(s.frozen_at);
  if (observed === null || frozen === null || timestamp(s.generated_at) !== generated) return result("unknown", "snapshot_time_missing");
  if (observed < times.close + 15 * 60000) return result("ineligible", "source_close_unconfirmed");
  if (!(observed <= generated && generated <= frozen && frozen <= now)) return result("unknown", "snapshot_time_order_invalid");
  if (frozen >= open) return result("ineligible", "published_after_target_open");
  return result("eligible", "qualified");
}
export function outcomeEligible(row: Row, horizon: string, now = Date.now()): boolean {
  if (qualifyForecast(row, horizon, now).status !== "eligible") return false;
  const s = row.Evaluation_Snapshot as EvaluationSnapshot;
  const proof = (row.Outcome_Evidence as Record<string, Row> | undefined)?.[horizon];
  const target = s.target_sessions[HORIZON_DAYS[horizon] - 1], observed = timestamp(proof?.source_observed_at);
  return !!proof && row[`Actual_${horizon}_Date`] === target && proof.target_session === target && proof.base_price === s.base_price && finitePositive(proof.actual_price)
    && proof.price_basis === s.price_basis && proof.source === s.source && observed !== null && equitySession(target)!.close + 15 * 60000 <= observed && observed <= now;
}
