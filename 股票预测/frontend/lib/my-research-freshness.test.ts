import { describe, expect, it } from "vitest";
import recorded from "../tests/fixtures/research-read-only-50.json";
import { createResearchDataLoader, type ResearchDataEntry } from "./my-research-data";
import { buildResearchQueue, deriveResearchCoverage, researchSemantics, seedResearchBaseline, type ResearchEntries } from "./my-research";
import type { MarketSnapshot } from "./types";

// Actual Preview 2a0db68 public snapshot responses; replay only, never calls hosted APIs.
const now = Date.parse("2026-10-10T19:41:43.355Z");
const original = recorded as unknown as MarketSnapshot[];
async function read(items = original, time = now) {
  const entries: ResearchEntries = {};
  const loader = createResearchDataLoader({ now: () => time, readCache: async () => null, writeCache: async () => {}, fetchBatch: async (symbols) => structuredClone(items.filter(item => symbols.includes(item.asset.symbol))) });
  const symbols = items.map(item => item.asset.symbol);
  await loader.load(symbols, update => Object.assign(entries, update.entries));
  return { entries, symbols, loader };
}
function invariants(coverage: ReturnType<typeof deriveResearchCoverage>) {
  expect(coverage.complete + coverage.partial + coverage.unavailable).toBe(coverage.processed);
  expect(coverage.processed + coverage.failed + coverage.unchecked).toBe(coverage.total);
  expect(coverage.checked).toBeLessThanOrEqual(coverage.complete);
}

describe("independent My Research freshness semantics", () => {
  it.each([[5, 5, 0, 0, 5], [20, 15, 5, 0, 20], [50, 15, 10, 25, 25]])("replays the real %i-asset sample without hiding partial expirations", async (total, complete, partial, unavailable, stale) => {
    const { entries, symbols } = await read(original.slice(0, total));
    const coverage = deriveResearchCoverage(symbols, entries, {}, now);
    expect(coverage).toMatchObject({ total, processed: total, complete, partial, unavailable, stale, checked: 0, failed: 0, unchecked: 0 });
    invariants(coverage);
    expect(seedResearchBaseline({}, entries)).toEqual({});
    expect(buildResearchQueue({ symbols, entries, baseline: {}, now: new Date(now) })).toEqual([]);
    expect(Object.values(entries).every(entry => researchSemantics(entry, now).freshness.market === "unverified")).toBe(true);
  });

  it.each([5, 20, 50])("excludes retained values after all %i reads fail, without losing their expiry", async count => {
    const items = original.slice(0, count); let fail = false;
    const entries: ResearchEntries = {};
    const loader = createResearchDataLoader({ now: () => now, readCache: async () => null, writeCache: async () => {}, fetchBatch: async symbols => {
      if (fail) throw Error("Offline");
      return structuredClone(items.filter(item => symbols.includes(item.asset.symbol)));
    } });
    const symbols = items.map(item => item.asset.symbol);
    const update = (value: { entries: ResearchEntries }) => Object.assign(entries, value.entries);
    await loader.load(symbols, update); fail = true;
    await loader.load(symbols, update, { force: true });
    const coverage = deriveResearchCoverage(symbols, entries, {}, now);
    expect(coverage).toMatchObject({ total: count, processed: 0, complete: 0, partial: 0, unavailable: 0, failed: count, checked: 0, stale: Math.min(count, 25), unchecked: 0 });
    expect(researchSemantics(entries.SPY, now)).toMatchObject({ execution: "failed", completeness: null, retained: true });
    expect(entries.SPY.history?.snapshot.latest_price).toBe(original[0].history?.snapshot.latest_price);
    invariants(coverage);
  });

  it("keeps in-flight and failed execution separate from completeness", async () => {
    const { entries } = await read(original.slice(0, 5));
    entries.SPY = { ...entries.SPY, status: "failed", queryCompleted: false };
    entries.QQQ = { status: "loading", errors: [] };
    const coverage = deriveResearchCoverage(["SPY", "QQQ", "AAPL", "NVDA", "MSFT", "UNKNOWN"], entries, {}, now);
    expect(coverage).toMatchObject({ processed: 3, complete: 3, failed: 1, unchecked: 2, loading: 1 });
    invariants(coverage);
  });

  it("distinguishes forecast expiry from market-cache expiry", async () => {
    const item = structuredClone(original[0]);
    item.read_only!.history = { ...item.read_only!.history, stored_at: new Date(now - 60_000).toISOString(), expires_at: now + 60_000, status: "available", reason: undefined };
    item.read_only!.forecast = { ...item.read_only!.forecast, expires_at: now - 1, status: "stale", reason: "forecast_expired" };
    const { entries } = await read([item]);
    expect(researchSemantics(entries.SPY, now).freshness).toMatchObject({ historyExpired: false, forecastExpired: true, stale: true, checked: false, market: "unverified" });
  });

  it("does not infer absent timestamps or equate date mismatch with expired cache", () => {
    const entry: ResearchDataEntry = { status: "stale", errors: [], queryCompleted: true, history: original[0].history, forecast: original[0].forecast,
      source: { ...original[0].read_only!, history: { ...original[0].read_only!.history, stored_at: null, expires_at: null, reason: "unknown_cache_age" }, forecast: { ...original[0].read_only!.forecast, generated_at: null, expires_at: null, status: "stale", reason: "market_date_mismatch" } } };
    expect(researchSemantics(entry, now)).toMatchObject({ execution: "processed", completeness: "complete", freshness: { clientAgeMs: null, historyAgeMs: null, forecastAgeMs: null, stale: false, checked: false, market: "unverified" } });
  });

  it("reports client age independently without weakening or replacing the comparison gate", async () => {
    const { entries } = await read(original.slice(0, 1));
    const entry = { ...entries.SPY, checkedAt: now - 3600_000 };
    expect(researchSemantics(entry, now).freshness).toMatchObject({ clientAgeMs: 3600_000, clientExpired: true, historyExpired: true, checked: false });
    const baseline = { SPY: { signal: "Up" as const, confidence: 70, invalidation: 90, data_as_of: "2026-10-08" } };
    expect(seedResearchBaseline(baseline, { SPY: entry })).toBe(baseline);
  });
});
