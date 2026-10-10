import { withReadOnlyMetadata } from "../tests/fixtures/research-snapshot";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createResearchDataLoader, RESEARCH_FRESH_MS, RESEARCH_STALE_MS } from "./my-research-data";
import type { ResearchDataUpdate } from "./my-research-data";
import type { Forecast, MarketSnapshot } from "./types";

function snapshot(symbol: string, price = 100): MarketSnapshot {
  return withReadOnlyMetadata({
    asset: { symbol, name: symbol, asset_type: "stock", data_source: "yahoo" },
    history: { symbol, data_source: "yahoo", data_as_of: "2026-10-04", snapshot: { latest_price: price }, records: [] },
    forecast: { symbol, signal: "Up", base_price: price, forecast_1m_return: 0.05, data_as_of: "2026-10-04" } as Forecast,
    errors: [],
  }, now);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const now = Date.UTC(2026, 9, 4, 10);
function loader(overrides: Parameters<typeof createResearchDataLoader>[0] = {}) {
  return createResearchDataLoader({ readCache: async () => null, writeCache: async () => {}, now: () => now, ...overrides });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("My Research bounded snapshot loading", () => {
  it.each([[5, 3], [20, 10], [50, 25]])("checks all %i assets using %i actual batch HTTP requests and no per-asset calls", async (count, expectedRequests) => {
    let active = 0;
    let maximumActive = 0;
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string) => {
      urls.push(input);
      active += 1;
      maximumActive = Math.max(active, maximumActive);
      const symbols = new URL(input, "https://example.test").searchParams.get("symbols")!.split(",");
      expect(symbols.length).toBeLessThanOrEqual(2);
      expect(new URL(input, "https://example.test").searchParams.get("mode")).toBe("read-only");
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return new Response(JSON.stringify({ data: symbols.map((symbol) => snapshot(symbol)) }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const entries: ResearchDataUpdate["entries"] = {};
    const resource = loader();
    const symbols = Array.from({ length: count }, (_, index) => `ASSET${index}`);
    await resource.load(symbols, (update) => Object.assign(entries, update.entries));
    expect(fetchMock).toHaveBeenCalledTimes(expectedRequests);
    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(Object.keys(entries)).toHaveLength(count);
    expect(Object.values(entries).every((entry) => entry.status === "fresh")).toBe(true);
    expect(urls.every((url) => new URL(url, "https://example.test").pathname === "/api/market/snapshot")).toBe(true);
    expect(urls.some((url) => /forecast\/|assets\/resolve/.test(url))).toBe(false);
    await resource.load(symbols, () => {});
    expect(fetchMock).toHaveBeenCalledTimes(expectedRequests);
  });

  it("keeps snapshot errors and marks incomplete or omitted assets as failed", async () => {
    const partial = { ...snapshot("BAD"), forecast: undefined, errors: [{ kind: "forecast" as const, message: "Forecast unavailable" }] };
    const resource = loader({ fetchBatch: async () => [snapshot("OK"), partial] });
    const entries: ResearchDataUpdate["entries"] = {};
    await resource.load(["OK", "BAD", "MISSING"], (update) => Object.assign(entries, update.entries));
    expect(entries.OK.status).toBe("fresh");
    expect(entries.BAD.status).toBe("failed");
    expect(entries.BAD.history).toBeDefined();
    expect(entries.BAD.errors).toContainEqual(partial.errors[0]);
    expect(entries.MISSING.status).toBe("failed");
    expect(entries.MISSING.asset).toBeUndefined();
  });

  it("all transport failures stay failed, never fresh/no-change or a successful baseline", async () => {
    const resource = loader({ fetchBatch: async () => { throw new Error("Offline"); } });
    const entries: ResearchDataUpdate["entries"] = {};
    await resource.load(["A", "B", "C", "D", "E"], (update) => Object.assign(entries, update.entries));
    expect(Object.values(entries).every((entry) => entry.status === "failed" && entry.checkedAt === undefined)).toBe(true);
    expect(entries.A.errors).toContainEqual({ kind: "network", message: "Offline" });
  });

  it("publishes later successful batches before an earlier slow batch completes", async () => {
    const slow = deferred<MarketSnapshot[]>();
    const entries: ResearchDataUpdate["entries"] = {};
    const fetchBatch = vi.fn((symbols: string[]) => symbols.includes("A") ? slow.promise : Promise.resolve(symbols.map((symbol) => snapshot(symbol))));
    const resource = loader({ fetchBatch });
    const running = resource.load(["A", "B", "C", "D", "E", "F", "G", "H", "I"], (update) => Object.assign(entries, update.entries));
    await vi.waitFor(() => expect(entries.I?.status).toBe("fresh"));
    expect(entries.A.status).toBe("loading");
    expect(fetchBatch).toHaveBeenCalledTimes(5);
    slow.resolve(["A", "B"].map((symbol) => snapshot(symbol)));
    await running;
    expect(entries.A.status).toBe("fresh");
  });

  it("emits stale data then its fresh replacement, preserving the cache's real age", async () => {
    const response = deferred<MarketSnapshot[]>();
    const updates: ResearchDataUpdate[] = [];
    const storedAt = now - RESEARCH_FRESH_MS - 1;
    const resource = loader({ readCache: async () => ({ value: { data: [snapshot("A", 90)] }, storedAt }), fetchBatch: () => response.promise });
    const running = resource.load(["A"], (update) => updates.push(update));
    await vi.waitFor(() => expect(updates[0]?.entries.A.status).toBe("stale"));
    expect(updates[0].entries.A.checkedAt).toBe(storedAt);
    response.resolve([snapshot("A", 110)]);
    await running;
    expect(updates.at(-1)?.entries.A.status).toBe("fresh");
    expect(updates.at(-1)?.entries.A.history?.snapshot.latest_price).toBe(110);
  });

  it("retains stale values on refresh failure with an explicit failure and old data date", async () => {
    const storedAt = now - RESEARCH_FRESH_MS - 1;
    const entries: ResearchDataUpdate["entries"] = {};
    const resource = loader({ readCache: async () => ({ value: { data: [snapshot("A", 90)] }, storedAt }), fetchBatch: async () => { throw new Error("Refresh failed"); } });
    await resource.load(["A"], (update) => Object.assign(entries, update.entries));
    expect(entries.A).toMatchObject({ status: "failed", dataStatus: "stale", checkedAt: storedAt });
    expect(entries.A.history?.snapshot.latest_price).toBe(90);
    expect(entries.A.errors).toContainEqual({ kind: "network", message: "Refresh failed" });
  });

  it("does not show expired data as a usable baseline", async () => {
    const updates: ResearchDataUpdate[] = [];
    const resource = loader({ readCache: async () => ({ value: { data: [snapshot("A", 90)] }, storedAt: now - RESEARCH_STALE_MS - 1 }), fetchBatch: async () => [snapshot("A", 110)] });
    await resource.load(["A"], (update) => updates.push(update));
    expect(updates[0].entries.A).toEqual({ status: "loading", errors: [] });
    expect(updates.at(-1)?.entries.A.status).toBe("fresh");
  });

  it("deduplicates concurrent consumers and cancels delivery/queued batches on unmount", async () => {
    const response = deferred<MarketSnapshot[]>();
    const fetchBatch = vi.fn(() => response.promise);
    const resource = loader({ fetchBatch });
    const firstUpdates = vi.fn();
    const secondUpdates = vi.fn();
    const controller = new AbortController();
    const first = resource.load(["A"], firstUpdates, { signal: controller.signal });
    const second = resource.load(["A"], secondUpdates);
    await vi.waitFor(() => expect(fetchBatch).toHaveBeenCalledTimes(1));
    controller.abort();
    firstUpdates.mockClear();
    response.resolve([snapshot("A")]);
    await Promise.all([first, second]);
    expect(firstUpdates).not.toHaveBeenCalled();
    expect(secondUpdates.mock.calls.at(-1)?.[0].entries.A.status).toBe("fresh");
  });

  it("does not recheck an empty list or silently apply a maximum watchlist size", async () => {
    const fetchBatch = vi.fn(async () => []);
    await loader({ fetchBatch }).load([], () => {});
    expect(fetchBatch).not.toHaveBeenCalled();
  });
});

describe("read-only completeness and cache isolation", () => {
  it.each(["history", "forecast", "both"] as const)("represents missing %s as partial/unavailable, not failure or checked", async (missing) => {
    const item = snapshot("A");
    if (missing !== "forecast") item.history = undefined;
    if (missing !== "history") item.forecast = undefined;
    const response = withReadOnlyMetadata(item, now);
    response.errors = (["history", "forecast"] as const).filter((kind) => !response[kind]).map((kind) => ({ kind, code: "unavailable", message: "not_cached" }));
    const entries: ResearchDataUpdate["entries"] = {};
    await loader({ fetchBatch: async () => [response] }).load(["A"], (update) => Object.assign(entries, update.entries));
    expect(entries.A.status).toBe(missing === "both" ? "unavailable" : "partial"); expect(entries.A.queryCompleted).toBe(true);
    const { deriveResearchCoverage, seedResearchBaseline, buildResearchQueue } = await import("./my-research");
    expect(deriveResearchCoverage(["A"], entries, {})).toMatchObject({ total: 1, queried: 1, checked: 0, failed: 0, [missing === "both" ? "unavailable" : "partial"]: 1 });
    expect(seedResearchBaseline({}, entries)).toEqual({}); expect(buildResearchQueue({ symbols: ["A"], entries, baseline: {} })).toEqual([]);
  });

  it("never treats HTTP 200 with old or absent metadata as fresh", async () => {
    const old = snapshot("OLD"); old.read_only!.history.status = "stale"; old.read_only!.history.expires_at = now - 1;
    const absent = snapshot("LEGACY"); delete absent.read_only;
    const entries: ResearchDataUpdate["entries"] = {};
    const resource = loader({ fetchBatch: async () => [old, absent] });
    await resource.load(["OLD", "LEGACY"], (update) => Object.assign(entries, update.entries));
    expect(entries.OLD.status).toBe("stale"); expect(entries.LEGACY.status).toBe("failed");
    await resource.load(["OLD", "LEGACY"], (update) => Object.assign(entries, update.entries), { force: true });
    expect(entries.OLD.status).toBe("stale"); expect(entries.OLD.source?.history.expires_at).toBe(now - 1);
  });

  it("expires at the source TTL even when the browser received it recently", async () => {
    let time = now; const item = snapshot("A"); item.read_only!.history.expires_at = now + 500;
    const entries: ResearchDataUpdate["entries"] = {}; const fetchBatch = vi.fn(async () => [item]);
    const resource = loader({ now: () => time, fetchBatch });
    await resource.load(["A"], (update) => Object.assign(entries, update.entries));
    expect(entries.A.freshUntil).toBe(now + 500); expect(entries.A.status).toBe("fresh");
    time += 501;
    // A later server response retains the underlying expiry rather than inventing a new TTL.
    item.read_only!.queried_at = new Date(time).toISOString(); item.read_only!.history.status = "stale";
    await resource.load(["A"], (update) => Object.assign(entries, update.entries));
    expect(fetchBatch).toHaveBeenCalledTimes(2); expect(entries.A.status).toBe("stale");
  });

  it("does not add slow request time to the remaining server cache lifetime", async () => {
    let time = now; const item = snapshot("A"); item.read_only!.history.expires_at = now + 500;
    const entries: ResearchDataUpdate["entries"] = {};
    const resource = loader({ now: () => time, fetchBatch: async () => { time += 1000; return [item]; } });
    await resource.load(["A"], (update) => Object.assign(entries, update.entries));
    expect(entries.A.status).toBe("stale"); expect(entries.A.freshUntil).toBe(now + 500);
  });

  it("caches unavailable results for 30 seconds locally, with a manual bypass and no false completion", async () => {
    let time = now;
    const item = withReadOnlyMetadata({ asset: snapshot("A").asset, errors: [] }, now);
    const fetchBatch = vi.fn(async () => [item]); const resource = loader({ now: () => time, fetchBatch });
    await resource.load(["A"], () => {}); await resource.load(["A"], () => {});
    expect(fetchBatch).toHaveBeenCalledTimes(1);
    await resource.load(["A"], () => {}, { force: true }); expect(fetchBatch).toHaveBeenCalledTimes(2);
    time += 30_001; await resource.load(["A"], () => {}); expect(fetchBatch).toHaveBeenCalledTimes(3);
  });

  it("retains previous values across an HTTP 200 source-read failure without confirming new actions", async () => {
    let fail = false; const entries: ResearchDataUpdate["entries"] = {};
    const resource = loader({ fetchBatch: async () => {
      const item = snapshot("A", 120);
      if (fail) { item.history = undefined; item.forecast = undefined; item.read_only!.query_status = "failed"; item.read_only!.history.status = "failed"; item.read_only!.forecast.status = "failed"; item.errors = [{ kind: "history", code: "failed", message: "read failed" }, { kind: "forecast", code: "failed", message: "read failed" }]; }
      return [item];
    } });
    await resource.load(["A"], (update) => Object.assign(entries, update.entries)); fail = true;
    await resource.load(["A"], (update) => Object.assign(entries, update.entries), { force: true });
    expect(entries.A).toMatchObject({ status: "failed", queryCompleted: false }); expect(entries.A.history?.snapshot.latest_price).toBe(120);
    const { buildResearchQueue, seedResearchBaseline } = await import("./my-research");
    expect(seedResearchBaseline({}, entries)).toEqual({});
    expect(buildResearchQueue({ symbols: ["A"], entries, baseline: {}, alerts: [{ id: "a", symbol: "A", enabled: true, type: "above", value: 110 }] })).toEqual([]);
  });

  it("a failed manual refresh stays failed across cache reuse and remount until a successful reread", async () => {
    let fail = false;
    let saved: { data: MarketSnapshot[] } | undefined;
    const entries: ResearchDataUpdate["entries"] = {};
    const fetchBatch = vi.fn(async () => { if (fail) throw new Error("Offline"); return [snapshot("A")]; });
    const resource = loader({ fetchBatch, writeCache: async (_path, value) => { saved = value; } });
    const update = (value: ResearchDataUpdate) => Object.assign(entries, value.entries);
    await resource.load(["A"], update); fail = true;
    await resource.load(["A"], update, { force: true }); await resource.load(["A"], update);
    expect(entries.A.status).toBe("failed"); expect(entries.A.queryCompleted).toBe(false); expect(fetchBatch).toHaveBeenCalledTimes(2);
    const remounted = loader({ fetchBatch, readCache: async () => saved ? { value: saved, storedAt: now } : null });
    await remounted.load(["A"], update); expect(entries.A.status).toBe("failed");
    fail = false; await remounted.load(["A"], update, { force: true }); expect(entries.A.status).toBe("fresh");
  });

  it("stale reversal is at most pending confirmation and cannot hit a new price condition", async () => {
    const item = snapshot("A", 120); item.read_only!.history.status = "stale";
    const entries: ResearchDataUpdate["entries"] = {};
    await loader({ fetchBatch: async () => [item] }).load(["A"], (update) => Object.assign(entries, update.entries));
    const { buildResearchQueue } = await import("./my-research");
    const tasks = buildResearchQueue({ symbols: ["A"], entries, baseline: { A: { signal: "Down", confidence: 70, invalidation: 90, price: 100, data_as_of: "2026-10-01" } }, alerts: [{ id: "a", symbol: "A", enabled: true, type: "above", value: 110 }] });
    expect(tasks).toHaveLength(1); expect(tasks[0].reasons).toHaveLength(1); expect(tasks[0].reasons[0]).toMatchObject({ kind: "direction_change", pendingConfirmation: true });
  });
});
