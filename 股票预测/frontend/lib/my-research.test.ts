import { describe, expect, it } from "vitest";
import {
  buildResearchQueue,
  deriveResearchCoverage,
  readResearchBaseline,
  RESEARCH_BASELINE_KEY,
  seedResearchBaseline,
  writeResearchBaseline,
  type ResearchBaseline,
  type ResearchDataEntry,
  type ResearchEntries,
} from "./my-research";
import type { AlertHistory, Forecast, PriceAlert, ResearchReview } from "./types";

const now = new Date("2026-10-04T12:00:00Z");
const initial: ResearchBaseline[string] = { signal: "Up", confidence: 70, invalidation: 90, price: 100, data_as_of: "2026-10-01" };
const review: ResearchReview = { symbol: "NVDA", reason: "invalidation", due_at: "2026-10-03T09:00:00Z", created_at: "2026-10-01T09:00:00Z", reference_price: 100, trigger_price: 90 };
const alert: PriceAlert = { id: "price-1", symbol: "NVDA", type: "below", value: 90, enabled: true };
const hit: AlertHistory = { ...alert, price: 89, change: -0.04, triggered_at: "2026-10-03T12:00:00Z" };
function entry(symbol = "NVDA", signal: Forecast["signal"] = "Down"): ResearchDataEntry {
  return {
    asset: { symbol, name: symbol, asset_type: "stock", data_source: "yahoo" },
    history: { symbol, data_source: "yahoo", data_as_of: "2026-10-03", snapshot: { latest_price: 89 }, records: [] },
    forecast: { symbol, signal, data_as_of: "2026-10-03", confidence_score: 70, key_levels: { invalidation: 95 }, base_price: 89 } as Forecast,
    errors: [], status: "fresh", checkedAt: Date.now(), queryCompleted: true,
  };
}
const queue = (overrides: Partial<Parameters<typeof buildResearchQueue>[0]> = {}) => buildResearchQueue({ symbols: ["NVDA"], baseline: { NVDA: initial }, entries: { NVDA: entry() }, now, ...overrides });

describe("My Research action queue", () => {
  it("merges due review, substantive reversal and existing alert into one asset task", () => {
    const tasks = queue({ symbols: ["NVDA", "nvda"], reviews: { NVDA: review }, alerts: [alert], alertHistory: [hit] });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ symbol: "NVDA", priority: 1, dueAt: review.due_at });
    expect(tasks[0].reasons.map((reason) => reason.kind)).toEqual(["review_due", "direction_change", "price_condition", "alert_triggered"]);
    expect(tasks[0].reasons[0]).toMatchObject({ review: { reference_price: 100, trigger_price: 90, reason: "invalidation" } });
  });

  it("does not create an action for date, model, ordinary price, confidence or level updates", () => {
    const current = entry("NVDA", "Up");
    current.forecast = { ...current.forecast!, best_model: "new-model", confidence_score: 73, key_levels: { ...current.forecast!.key_levels!, invalidation: 95 }, forecast_1m_return: 0.12 };
    expect(queue({ entries: { NVDA: current } })).toEqual([]);
  });

  it("only treats a directional reversal as substantive, not an Observe transition", () => {
    expect(queue({ entries: { NVDA: entry("NVDA", "Observe") } })).toEqual([]);
    expect(queue({ baseline: { NVDA: { ...initial, signal: "Observe" } } })).toEqual([]);
    expect(queue({ baseline: { NVDA: { ...initial, signal: "Down" } }, entries: { NVDA: entry("NVDA", "Up") } })[0].reasons[0].kind).toBe("direction_change");
  });

  it.each(["failed", "stale", "loading", "unchecked"] as const)("does not infer new changes from %s data", (status) => {
    expect(queue({ entries: { NVDA: { ...entry(), status } } })).toEqual([]);
  });

  it("rejects fresh partial, invalid or baseline-free comparisons", () => {
    expect(queue({ entries: { NVDA: { ...entry(), errors: [{ kind: "history", message: "unavailable" }] } } })).toEqual([]);
    expect(queue({ entries: { NVDA: { ...entry(), history: undefined } } })).toEqual([]);
    const invalid = entry();
    invalid.history!.snapshot.latest_price = null;
    expect(queue({ entries: { NVDA: invalid } })).toEqual([]);
    expect(queue({ baseline: {} })).toEqual([]);
  });

  it("retains a previously confirmed cached reversal during a failed refresh, explicitly pending confirmation", () => {
    const current = { ...entry(), status: "failed" as const, dataStatus: "stale" as const, errors: [{ kind: "network", message: "Offline" }] };
    expect(queue({ entries: { NVDA: current } })[0].reasons[0]).toMatchObject({ kind: "direction_change", pendingConfirmation: true });
    expect(queue({ entries: { NVDA: { ...current, errors: [{ kind: "forecast", message: "Missing forecast" }] } } })).toEqual([]);
    expect(queue({ entries: { NVDA: { ...current, checkedAt: undefined } } })).toEqual([]);
  });

  it("checks enabled user price/daily thresholds only with complete fresh data", () => {
    const current = entry("NVDA", "Up");
    current.history!.snapshot.return_1d = -.06;
    const rules: PriceAlert[] = [alert, { id: "move", symbol: "NVDA", type: "change", value: 5, enabled: true }];
    const task = queue({ entries: { NVDA: current }, alerts: rules })[0];
    expect(task.reasons.map((reason) => reason.kind)).toEqual(["price_condition", "price_condition"]);
    expect(task.priority).toBe(1);
    expect(queue({ entries: { NVDA: { ...current, status: "stale" } }, alerts: rules })).toEqual([]);
    expect(queue({ entries: { NVDA: current }, alerts: rules.map((rule) => ({ ...rule, enabled: false })) })).toEqual([]);
  });

  it("keeps due plans despite missing market data and sorts overdue plans first", () => {
    const tasks = queue({ symbols: [], entries: {}, reviews: {
      NVDA: { ...review, due_at: "2026-10-03T09:00:00Z" },
      AAPL: { ...review, symbol: "AAPL", due_at: "2026-10-02T09:00:00Z" },
      MSFT: { ...review, symbol: "MSFT", due_at: "2026-10-05T09:00:00Z" },
      INVALID: { ...review, symbol: "INVALID", due_at: "invalid" },
    } });
    expect(tasks.map((task) => task.symbol)).toEqual(["AAPL", "NVDA"]);
    expect(tasks.every((task) => task.reasons[0].kind === "review_due")).toBe(true);
  });

  it("never calls a planned invalidation level triggered based on the current model", () => {
    const current = entry("NVDA", "Up");
    expect(queue({ entries: { NVDA: current }, reviews: { NVDA: { ...review, due_at: "2026-10-05T09:00:00Z" } } })).toEqual([]);
    const task = queue({ entries: { NVDA: current }, reviews: { NVDA: review } })[0];
    expect(task.priority).toBe(1);
    expect(task.reasons.map((reason) => reason.kind)).toEqual(["review_due"]);
  });

  it("keeps read alerts as historical evidence and deduplicates repeated rule hits to latest", () => {
    const latest = { ...hit, triggered_at: "2026-10-04T10:00:00Z", read_at: "2026-10-04T11:00:00Z" };
    const tasks = queue({ entries: {}, alerts: [{ ...alert, enabled: false }], alertHistory: [hit, latest, latest] });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].reasons).toEqual([{ id: "alert:NVDA:price-1:below", kind: "alert_triggered", alert: { ...alert, enabled: false }, history: latest }]);
  });

  it("does not generate historical evidence for changed/deleted rules or malformed/future events", () => {
    expect(queue({ entries: {}, alerts: [{ ...alert, value: 80 }], alertHistory: [hit] })).toEqual([]);
    expect(queue({ entries: {}, alerts: [], alertHistory: [hit] })).toEqual([]);
    expect(queue({ entries: {}, alerts: [alert], alertHistory: [{ ...hit, triggered_at: "invalid" }, { ...hit, triggered_at: "2026-10-10T12:00:00Z" }] })).toEqual([]);
  });

  it("returns a true empty state for a new user", () => {
    expect(queue({ symbols: [], entries: {}, baseline: {}, reviews: {}, alerts: [], alertHistory: [] })).toEqual([]);
    expect(deriveResearchCoverage([], {}, {})).toEqual({ total: 0, resolved: 0, checked: 0, failed: 0, processed: 0, complete: 0, queried: 0, partial: 0, unavailable: 0, unchecked: 0, loading: 0, stale: 0, noBaseline: 0, unchanged: 0 });
  });
});

describe("My Research coverage", () => {
  it.each([5, 20, 50])("covers every one of %i followed assets without comparison-tool limits", (count) => {
    const symbols = Array.from({ length: count }, (_, index) => `ASSET${index}`);
    const entries = Object.fromEntries(symbols.map((symbol) => [symbol, entry(symbol, "Up")]));
    const baseline = Object.fromEntries(symbols.map((symbol) => [symbol, initial]));
    expect(deriveResearchCoverage(symbols, entries, baseline)).toEqual({ total: count, resolved: count, checked: count, failed: 0, processed: count, complete: count, queried: count, partial: 0, unavailable: 0, unchecked: 0, loading: 0, stale: 0, noBaseline: 0, unchanged: count });
  });

  it("never reports failures as checked/no change", () => {
    const entries = { NVDA: { ...entry(), status: "failed" as const, errors: [{ kind: "forecast", message: "timeout" }] }, AAPL: { ...entry("AAPL"), status: "failed" as const } };
    expect(deriveResearchCoverage(["NVDA", "AAPL"], entries, { NVDA: initial, AAPL: initial })).toMatchObject({ total: 2, checked: 0, failed: 2, unchanged: 0 });
  });

  it("distinguishes partial success, stale, loading, no baseline and unchecked", () => {
    const entries: ResearchEntries = {
      NVDA: entry("NVDA", "Up"),
      AAPL: { ...entry("AAPL"), status: "failed" },
      MSFT: { ...entry("MSFT"), status: "stale" },
      META: { ...entry("META"), status: "loading" },
      NFLX: entry("NFLX", "Up"),
    };
    const coverage = deriveResearchCoverage(["NVDA", "AAPL", "MSFT", "META", "NFLX", "UNRESOLVED", "nvda"], entries, { NVDA: initial });
    expect(coverage).toEqual({ total: 6, resolved: 5, checked: 2, failed: 1, processed: 3, complete: 3, queried: 3, partial: 0, unavailable: 0, unchecked: 2, loading: 1, stale: 0, noBaseline: 1, unchanged: 1 });
    expect(coverage.processed + coverage.failed + coverage.unchecked).toBe(coverage.total);
  });
});

describe("pinned My Research baseline", () => {
  it("seeds only fresh complete data and uses actual history price", () => {
    const current = entry("NVDA", "Up");
    current.forecast!.base_price = 10;
    const seeded = seedResearchBaseline({}, {
      NVDA: current, STALE: { ...entry("STALE"), status: "stale" }, FAILED: { ...entry("FAILED"), status: "failed" }, PARTIAL: { ...entry("PARTIAL"), history: undefined },
    });
    expect(Object.keys(seeded)).toEqual(["NVDA"]);
    expect(seeded.NVDA.price).toBe(89);
  });

  it("refresh/reload does not advance a pinned baseline or dismiss a reversal", () => {
    const stored = new Map<string, string>();
    const storage = { getItem: (key: string) => stored.get(key) || null, setItem: (key: string, value: string) => { stored.set(key, value); } };
    const baseline = { NVDA: initial };
    expect(writeResearchBaseline(storage, baseline)).toBe(true);
    const entries = { NVDA: entry() };
    const reloaded = readResearchBaseline(storage);
    expect(seedResearchBaseline(reloaded, entries)).toBe(reloaded);
    expect(queue({ baseline: reloaded, entries })).toHaveLength(1);
    expect(readResearchBaseline(storage)).toEqual(baseline);
    expect(stored.has(RESEARCH_BASELINE_KEY)).toBe(true);
  });

  it("does not mutate the existing object and tolerates unavailable or corrupt local storage", () => {
    const baseline = { AAPL: initial };
    expect(seedResearchBaseline(baseline, { NVDA: entry() })).not.toBe(baseline);
    expect(baseline).toEqual({ AAPL: initial });
    expect(readResearchBaseline({ getItem: () => "invalid json" })).toEqual({});
    expect(readResearchBaseline({ getItem: () => JSON.stringify({ NVDA: { signal: "wrong" }, AAPL: initial }) })).toEqual({ AAPL: initial });
    expect(readResearchBaseline({ getItem: () => { throw new Error("unavailable"); } })).toEqual({});
    expect(writeResearchBaseline({ setItem: () => { throw new Error("quota"); } }, baseline)).toBe(false);
  });
});
