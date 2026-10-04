import type { AlertHistory, Asset, Forecast, History, PriceAlert, ResearchReview, UserState } from "./types";

export type ResearchBaseline = NonNullable<UserState["forecast_snapshots"]>;
export type ResearchSnapshot = ResearchBaseline[string];
export type ResearchDataEntry = {
  asset?: Asset;
  history?: History;
  forecast?: Forecast;
  errors: Array<{ kind: string; message: string }>;
  status: "loading" | "fresh" | "stale" | "failed" | "unchecked";
  checkedAt?: number;
  dataStatus?: "fresh" | "stale";
};
export type ResearchEntries = Record<string, ResearchDataEntry>;
export type ResearchReason =
  | { id: string; kind: "review_due"; review: ResearchReview }
  | { id: string; kind: "direction_change"; previous: ResearchSnapshot; current: ResearchSnapshot; pendingConfirmation?: boolean }
  | { id: string; kind: "price_condition"; alert: PriceAlert; current: number; dataAsOf: string }
  | { id: string; kind: "alert_triggered"; alert: PriceAlert; history: AlertHistory };
export type ResearchTask = {
  symbol: string;
  priority: 0 | 1;
  reasons: ResearchReason[];
  dueAt?: string;
};
export type ResearchCoverage = {
  total: number;
  resolved: number;
  checked: number;
  failed: number;
  /** Loading is a subset of unchecked. Checked, failed, stale and unchecked partition total. */
  unchecked: number;
  loading: number;
  stale: number;
  noBaseline: number;
  /** Fresh complete forecast comparisons without a meaningful change, not completed reviews. */
  unchanged: number;
};

// Scoped privateStorage is supplied by the existing provider. This baseline is deliberately
// independent of the homepage's last-visit snapshot and the alert job's rolling baseline.
export const RESEARCH_BASELINE_KEY = "orivane-my-research-baseline-v1";

export function researchSymbols(symbols: readonly string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validSnapshot(value: unknown): value is ResearchSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<ResearchSnapshot>;
  return ["Up", "Down", "Observe"].includes(item.signal || "")
    && typeof item.data_as_of === "string" && item.data_as_of.length > 0
    && (item.confidence === null || finite(item.confidence))
    && (item.invalidation === null || finite(item.invalidation))
    && (item.price === undefined || item.price === null || finite(item.price));
}

/** A fresh partial response cannot establish a baseline or support a no-change claim. */
export function completeResearchEntry(entry?: ResearchDataEntry): entry is ResearchDataEntry & { asset: Asset; history: History; forecast: Forecast } {
  return Boolean(entry?.status === "fresh" && !entry.errors.length && entry.asset && entry.history && entry.forecast
    && finite(entry.history.snapshot?.latest_price) && entry.history.snapshot.latest_price > 0
    && entry.history.data_as_of && entry.forecast.data_as_of
    && ["Up", "Down", "Observe"].includes(entry.forecast.signal));
}

export function researchSnapshot(entry: ResearchDataEntry): ResearchSnapshot | null {
  if (!completeResearchEntry(entry)) return null;
  return {
    signal: entry.forecast.signal,
    confidence: finite(entry.forecast.confidence_score) ? entry.forecast.confidence_score : null,
    invalidation: finite(entry.forecast.key_levels?.invalidation) ? entry.forecast.key_levels.invalidation : null,
    data_as_of: entry.forecast.data_as_of,
    price: entry.history.snapshot.latest_price as number,
  };
}

export function readResearchBaseline(storage: Pick<Storage, "getItem">): ResearchBaseline {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RESEARCH_BASELINE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => validSnapshot(value)).map(([symbol, value]) => [symbol.trim().toUpperCase(), value]));
  } catch { return {}; }
}

/** Initialize missing baselines only. Checking, viewing and refreshing never advance them. */
export function seedResearchBaseline(baseline: ResearchBaseline, entries: ResearchEntries): ResearchBaseline {
  let next = baseline;
  for (const [symbol, entry] of Object.entries(entries)) {
    const key = symbol.trim().toUpperCase();
    if (!key || validSnapshot(baseline[key])) continue;
    const snapshot = researchSnapshot(entry);
    if (!snapshot) continue;
    if (next === baseline) next = { ...baseline };
    next[key] = snapshot;
  }
  return next;
}

export function writeResearchBaseline(storage: Pick<Storage, "setItem">, baseline: ResearchBaseline): boolean {
  try { storage.setItem(RESEARCH_BASELINE_KEY, JSON.stringify(baseline)); return true; } catch { return false; }
}

function directionReversed(previous: ResearchSnapshot, current: ResearchSnapshot): boolean {
  return (previous.signal === "Up" && current.signal === "Down") || (previous.signal === "Down" && current.signal === "Up");
}

export function deriveResearchCoverage(symbols: readonly string[], entries: ResearchEntries, baseline: ResearchBaseline = {}): ResearchCoverage {
  const coverage: ResearchCoverage = { total: 0, resolved: 0, checked: 0, failed: 0, unchecked: 0, loading: 0, stale: 0, noBaseline: 0, unchanged: 0 };
  for (const symbol of researchSymbols(symbols)) {
    coverage.total += 1;
    const entry = entries[symbol];
    if (entry?.asset) coverage.resolved += 1;
    const current = entry && researchSnapshot(entry);
    if (current) {
      coverage.checked += 1;
      const previous = baseline[symbol];
      if (!validSnapshot(previous)) coverage.noBaseline += 1;
      else if (!directionReversed(previous, current)) coverage.unchanged += 1;
    } else if (entry?.status === "failed" || entry?.status === "fresh") coverage.failed += 1;
    else if (entry?.status === "stale") coverage.stale += 1;
    else {
      coverage.unchecked += 1;
      if (entry?.status === "loading") coverage.loading += 1;
    }
  }
  return coverage;
}

export function buildResearchQueue({ symbols, reviews = {}, alerts = [], alertHistory = [], baseline, entries, now = new Date() }: {
  symbols: readonly string[];
  reviews?: Record<string, ResearchReview>;
  alerts?: PriceAlert[];
  alertHistory?: AlertHistory[];
  baseline: ResearchBaseline;
  entries: ResearchEntries;
  now?: Date;
}): ResearchTask[] {
  const tasks = new Map<string, ResearchTask>();
  const add = (symbol: string, reason: ResearchReason) => {
    const key = symbol.trim().toUpperCase();
    if (!key) return;
    // No current record contains a user's directional thesis or an explicit high-priority
    // price rule. Do not infer P0 from the current model or from an ordinary price alert.
    const task = tasks.get(key) || { symbol: key, priority: 1, reasons: [] };
    if (!task.reasons.some((item) => item.id === reason.id)) task.reasons.push(reason);
    if (reason.kind === "review_due") task.dueAt = reason.review.due_at;
    tasks.set(key, task);
  };

  for (const review of Object.values(reviews)) {
    const due = Date.parse(review.due_at);
    if (Number.isFinite(due) && due <= now.getTime()) add(review.symbol, { id: `review:${review.symbol.toUpperCase()}`, kind: "review_due", review });
  }
  for (const symbol of researchSymbols(symbols)) {
    const previous = baseline[symbol];
    const entry = entries[symbol];
    const current = entry && researchSnapshot(entry);
    // Retain a previously successful cached reversal when its refresh is pending/failed.
    // It is explicitly historical evidence, never a fresh risk confirmation.
    const retained = !current && entry?.dataStatus && entry.checkedAt && entry.errors.every((error) => error.kind === "network")
      ? researchSnapshot({ ...entry, status: "fresh", errors: [] }) : null;
    const observed = current || retained;
    if (validSnapshot(previous) && observed && observed.data_as_of >= previous.data_as_of && directionReversed(previous, observed)) {
      add(symbol, { id: `direction:${symbol}`, kind: "direction_change", previous, current: observed, ...(!current ? { pendingConfirmation: true } : {}) });
    }
  }

  // Check explicit user thresholds only against complete fresh evidence. An ordinary
  // price rule has no stored high-priority flag, so it remains P1 rather than inferred P0.
  for (const alert of alerts) {
    if (!alert.enabled) continue;
    const symbol = alert.symbol.trim().toUpperCase();
    const entry = entries[symbol];
    if (!completeResearchEntry(entry) || typeof alert.value !== "number" || !Number.isFinite(alert.value)) continue;
    const price = entry.history.snapshot.latest_price as number;
    const daily = entry.history.snapshot.return_1d;
    const current = alert.type === "change" && finite(daily) ? daily * 100 : price;
    const hit = alert.type === "above" ? price >= alert.value
      : alert.type === "below" ? price <= alert.value
        : alert.type === "change" && finite(daily) ? Math.abs(current) >= Math.abs(alert.value) : false;
    if (hit) add(symbol, { id: `condition:${alert.id}`, kind: "price_condition", alert, current, dataAsOf: entry.history.data_as_of });
  }

  // AlertHistory stores the originating rule id. Preserve the latest recorded hit per
  // unchanged rule; reading a notification is not evidence of completing research.
  const latestAlerts = new Map<string, { alert: PriceAlert; history: AlertHistory }>();
  for (const history of alertHistory) {
    const timestamp = Date.parse(history.triggered_at);
    if (!Number.isFinite(timestamp) || timestamp > now.getTime()) continue;
    const alert = alerts.find((rule) => rule.id === history.id && rule.symbol.trim().toUpperCase() === history.symbol.trim().toUpperCase()
      && rule.type === history.type && String(rule.value) === String(history.value));
    if (!alert) continue;
    const key = `${alert.symbol.trim().toUpperCase()}:${alert.id}:${alert.type}`;
    const previous = latestAlerts.get(key);
    if (!previous || Date.parse(previous.history.triggered_at) < timestamp) latestAlerts.set(key, { alert, history });
  }
  for (const [key, { alert, history }] of latestAlerts) add(history.symbol, { id: `alert:${key}`, kind: "alert_triggered", alert, history });

  return [...tasks.values()].sort((a, b) => a.priority - b.priority
    || (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity)
    || a.symbol.localeCompare(b.symbol));
}
