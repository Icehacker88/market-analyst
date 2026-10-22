import calendar from "../../../../contracts/us-equity-calendar.json";

export const EQUITY_CALENDAR_VERSION = calendar.version;
export const TIMING_PROTOCOL = "frozen-close-v1";
// Settlement's check that the frozen base close was not revised. 0.01% absorbs float32
// storage noise and the cent-level gap between Yahoo's after-close meta price (used to
// freeze) and the later finalized bar; splits and real corrections are far larger.
export const BASE_PRICE_REVISION_RTOL = 1e-4;
export const HORIZON_DAYS: Record<string, number> = { "1D": 1, "5D": 5, "10D": 10, "1M": 22 };
// Live freeze/settlement basis. Adj Close rewrites every past day at each ex-dividend date,
// so a frozen Adj Close base would never match again; Close only changes on splits.
// Live scores are therefore price returns: any window that spans an ex-dividend date omits that dividend.
export const SETTLEMENT_BASIS = "Close";
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
type EquityIdentity = { symbol: string; asset_type?: string; exchange?: string | null; currency?: string | null };
export function supportsEquityCalendar(asset: EquityIdentity): boolean {
  return knownSymbols.has(asset.symbol) || (["stock", "etf"].includes(asset.asset_type || "") && asset.currency === "USD" && ["NYSE", "NYSE Arca", "NASDAQ", "NMS", "NGM", "NCM", "NYQ", "PCX", "ASE", "AMEX", "BATS"].includes(asset.exchange || ""));
}
// Call only for an identified US equity. Exchange-local dates, reviewed holidays,
// early closes and DST determine the latest completed session and its window.
export function currentPublicationWindow(now = Date.now()): { base_session: string; confirmed_at: number; next_open: number } | null {
  if (!Number.isFinite(now)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  const localDay = `${part("year")}-${part("month")}-${part("day")}`;
  if (localDay < calendar.first_date || localDay > calendar.last_date) return null;
  for (let offset = 0; offset < 10; offset++) {
    const day = new Date(Date.parse(`${localDay}T00:00:00Z`) - offset * 86400000).toISOString().slice(0, 10);
    const times = equitySession(day);
    if (!times || times.close > now) continue;
    const next = followingSessions(day, 1)[0];
    const nextOpen = next ? equitySession(next)?.open : null;
    return nextOpen && now >= times.close + 900000 && now < nextOpen
      ? { base_session: day, confirmed_at: times.close + 900000, next_open: nextOpen } : null;
  }
  return null;
}
export function makeEvaluationSnapshot(asset: { symbol: string; asset_type?: string; exchange?: string | null; currency?: string | null }, base: Row, source: unknown, observed: unknown, generated: string): EvaluationSnapshot {
  const supported = supportsEquityCalendar(asset);
  const close = finitePositive(base.Close) ? base.Close : null;
  return { schema_version: TIMING_PROTOCOL, calendar: supported ? calendar.version : null, symbol: asset.symbol, base_session: String(base.Date || ""), base_price: close,
    price_basis: close === null ? null : SETTLEMENT_BASIS, source: typeof source === "string" ? source : null, source_observed_at: typeof observed === "string" ? observed : null,
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
  if (!finitePositive(s.base_price) || s.price_basis !== SETTLEMENT_BASIS || !s.source) return result("unknown", "price_provenance_missing");
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
