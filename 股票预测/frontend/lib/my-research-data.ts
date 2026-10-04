import { getResearchSnapshotBatch, researchSnapshotPath } from "./api";
import { readOfflineResponse, writeOfflineResponse } from "./offline-store";
import type { Asset, Forecast, History, MarketSnapshot } from "./types";

export const RESEARCH_BATCH_SIZE = 4;
export const RESEARCH_BATCH_CONCURRENCY = 2;
export const RESEARCH_FRESH_MS = 15 * 60_000;
export const RESEARCH_STALE_MS = 24 * 3600_000;

export type ResearchDataEntry = {
  asset?: Asset;
  history?: History;
  forecast?: Forecast;
  errors: { kind: string; message: string }[];
  status: "loading" | "fresh" | "stale" | "failed" | "unchecked";
  checkedAt?: number;
  /** A failed refresh can retain useful old data, without calling it fresh. */
  dataStatus?: "fresh" | "stale";
};

export type ResearchDataUpdate = {
  entries: Record<string, ResearchDataEntry>;
  lastCheckedAt?: number;
};

type CachedBatch = { value: { data: MarketSnapshot[] }; storedAt: number };
type DataDependencies = {
  fetchBatch: typeof getResearchSnapshotBatch;
  readCache: (path: string) => Promise<CachedBatch | null>;
  writeCache: (path: string, value: { data: MarketSnapshot[] }) => Promise<void>;
  now: () => number;
};

export function normalizeResearchSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
}

export function researchHistoryStart(now = Date.now()): string {
  const date = new Date(now);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

export function initialResearchEntries(symbols: string[]): Record<string, ResearchDataEntry> {
  return Object.fromEntries(normalizeResearchSymbols(symbols).map((symbol) => [symbol, { status: "unchecked", errors: [] }]));
}

function hasAssetIdentity(asset: Asset | undefined): asset is Asset {
  return Boolean(asset?.symbol && asset.name && asset.asset_type && asset.data_source);
}

function batchEntries(symbols: string[], cached: CachedBatch, now: number): Record<string, ResearchDataEntry> {
  const bySymbol = new Map(cached.value.data.filter((item) => item && typeof item.asset?.symbol === "string").map((item) => [item.asset.symbol.toUpperCase(), item]));
  const dataStatus = now - cached.storedAt <= RESEARCH_FRESH_MS ? "fresh" : "stale";
  return Object.fromEntries(symbols.map((symbol) => {
    const item = bySymbol.get(symbol);
    const errors = [...(Array.isArray(item?.errors) ? item.errors.filter((error) => error && typeof error.kind === "string" && typeof error.message === "string") : [])];
    if (!hasAssetIdentity(item?.asset) && !errors.some((error) => error.kind === "asset")) errors.push({ kind: "asset", message: "Asset missing from snapshot response." });
    if (!item?.history && !errors.some((error) => error.kind === "history")) errors.push({ kind: "history", message: "Market data missing from snapshot response." });
    if (!item?.forecast && !errors.some((error) => error.kind === "forecast")) errors.push({ kind: "forecast", message: "Forecast missing from snapshot response." });
    if (item?.history && (!item.history.data_as_of || typeof item.history.snapshot?.latest_price !== "number" || !Number.isFinite(item.history.snapshot.latest_price) || item.history.snapshot.latest_price <= 0) && !errors.some((error) => error.kind === "history")) errors.push({ kind: "history", message: "Market date or price is invalid." });
    if (item?.forecast && (!item.forecast.data_as_of || !["Up", "Down", "Observe"].includes(item.forecast.signal)) && !errors.some((error) => error.kind === "forecast")) errors.push({ kind: "forecast", message: "Forecast date or direction is invalid." });
    return [symbol, {
      asset: hasAssetIdentity(item?.asset) ? item.asset : undefined,
      history: item?.history,
      forecast: item?.forecast,
      errors,
      status: errors.length ? "failed" : dataStatus,
      checkedAt: cached.storedAt,
      dataStatus,
    } satisfies ResearchDataEntry];
  }));
}

/** Public market-data resource: no account state, review status or baseline writes. */
export function createResearchDataLoader(overrides: Partial<DataDependencies> = {}) {
  const deps: DataDependencies = {
    fetchBatch: getResearchSnapshotBatch,
    readCache: (path) => readOfflineResponse<{ data: MarketSnapshot[] }>(path),
    writeCache: writeOfflineResponse,
    now: Date.now,
    ...overrides,
  };
  const memory = new Map<string, CachedBatch>();
  const inflight = new Map<string, Promise<CachedBatch>>();

  function fetchBatch(path: string, symbols: string[], start: string): Promise<CachedBatch> {
    const current = inflight.get(path);
    if (current) return current;
    const pending = deps.fetchBatch(symbols, start).then((data) => {
      if (!Array.isArray(data)) throw new Error("Invalid snapshot response.");
      const cached = { value: { data }, storedAt: deps.now() };
      memory.set(path, cached);
      void deps.writeCache(path, cached.value).catch(() => undefined);
      return cached;
    });
    inflight.set(path, pending);
    void pending.finally(() => { if (inflight.get(path) === pending) inflight.delete(path); }).catch(() => undefined);
    return pending;
  }

  async function load(
    rawSymbols: string[],
    onUpdate: (update: ResearchDataUpdate) => void,
    options: { force?: boolean; signal?: AbortSignal; start?: string } = {},
  ): Promise<void> {
    const symbols = normalizeResearchSymbols(rawSymbols);
    const start = options.start || researchHistoryStart(deps.now());
    const batches = Array.from({ length: Math.ceil(symbols.length / RESEARCH_BATCH_SIZE) }, (_, index) => symbols.slice(index * RESEARCH_BATCH_SIZE, (index + 1) * RESEARCH_BATCH_SIZE));
    let nextBatch = 0;
    const emit = (update: ResearchDataUpdate) => { if (!options.signal?.aborted) onUpdate(update); };
    const runBatch = async (batch: string[]) => {
      const path = researchSnapshotPath(batch, start);
      let cached = memory.get(path) || null;
      if (!cached) {
        try { cached = await deps.readCache(path); } catch { /* Cache failure does not prevent a network check. */ }
      }
      if (options.signal?.aborted) return;
      if (cached && (!Number.isFinite(cached.storedAt) || !Array.isArray(cached.value?.data) || deps.now() - cached.storedAt > RESEARCH_STALE_MS || cached.storedAt > deps.now())) cached = null;
      const previous = cached ? batchEntries(batch, cached, deps.now()) : null;
      if (previous) emit({ entries: previous, lastCheckedAt: cached!.storedAt });
      const completelyFresh = previous && Object.values(previous).every((entry) => entry.status === "fresh");
      if (!options.force && completelyFresh) return;
      if (!previous) emit({ entries: Object.fromEntries(batch.map((symbol) => [symbol, { status: "loading", errors: [] }])) });
      try {
        const fresh = await fetchBatch(path, batch, start);
        emit({ entries: batchEntries(batch, fresh, deps.now()), lastCheckedAt: fresh.storedAt });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Snapshot request failed.";
        const entries = Object.fromEntries(batch.map((symbol) => [symbol, {
          ...previous?.[symbol],
          errors: [...(previous?.[symbol].errors || []), { kind: "network", message }],
          status: "failed" as const,
        }]));
        emit({ entries, lastCheckedAt: deps.now() });
      }
    };
    await Promise.all(Array.from({ length: Math.min(RESEARCH_BATCH_CONCURRENCY, batches.length) }, async () => {
      while (!options.signal?.aborted && nextBatch < batches.length) await runBatch(batches[nextBatch++]);
    }));
  }

  return { load };
}

export const researchDataLoader = createResearchDataLoader();
