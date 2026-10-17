import { getResearchSnapshotBatch, researchSnapshotPath } from "./api";
import { readOfflineResponse, writeOfflineResponse } from "./offline-store";
import type { Asset, Forecast, History, MarketSnapshot, ReadOnlySnapshotMetadata } from "./types";

export const RESEARCH_BATCH_SIZE = 2;
export const RESEARCH_BATCH_CONCURRENCY = 2;
export const RESEARCH_FRESH_MS = 15 * 60_000;
export const RESEARCH_NEGATIVE_MS = 30_000;
export const RESEARCH_STALE_MS = 24 * 3600_000;

export type ResearchDataEntry = {
  asset?: Asset;
  history?: History;
  forecast?: Forecast;
  errors: { kind: string; message: string }[];
  status: "loading" | "fresh" | "stale" | "failed" | "unchecked" | "partial" | "unavailable";
  checkedAt?: number;
  queryCompleted?: boolean;
  source?: ReadOnlySnapshotMetadata;
  freshUntil?: number;
  /** A failed refresh can retain useful old data, without calling it fresh. */
  dataStatus?: "fresh" | "stale";
};

export type ResearchDataUpdate = {
  entries: Record<string, ResearchDataEntry>;
  lastCheckedAt?: number;
};

type CachedValue = { data: MarketSnapshot[]; requestedAt?: number; receivedAt?: number; refreshFailedAt?: number; refreshError?: string };
type CachedBatch = { value: CachedValue; storedAt: number };
type DataDependencies = {
  fetchBatch: typeof getResearchSnapshotBatch;
  readCache: (path: string) => Promise<CachedBatch | null>;
  writeCache: (path: string, value: CachedValue) => Promise<void>;
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
  return Object.fromEntries(symbols.map((symbol) => {
    const item = bySymbol.get(symbol);
    const source = item?.read_only;
    const errors: { kind: string; message: string; code?: string }[] = [...(Array.isArray(item?.errors) ? item.errors.filter((error) => error && typeof error.kind === "string" && typeof error.message === "string") : [])];
    if (cached.value.refreshError) errors.push({ kind: "network", message: cached.value.refreshError });
    const queried = source ? Date.parse(source.queried_at) : NaN;
    const sourceValid = source?.version === 1 && Number.isFinite(queried) && ["complete", "failed"].includes(source.query_status)
      && source.history?.source === "history_cache" && source.forecast?.source === "frozen_forecast"
      && [source.history, source.forecast].every((meta) => ["available", "stale", "unavailable", "failed"].includes(meta.status));
    const asset = hasAssetIdentity(item?.asset) ? item.asset : undefined;
    const history = item?.history?.symbol === symbol && item.history.data_as_of && Number.isFinite(item.history.snapshot?.latest_price) && Number(item.history.snapshot.latest_price) > 0 ? item.history : undefined;
    const forecast = item?.forecast?.symbol === symbol && item.forecast.data_as_of && ["Up", "Down", "Observe"].includes(item.forecast.signal) && Number.isFinite(item.forecast.forecast_1m_return) ? item.forecast : undefined;
    if (!asset) errors.push({ kind: "asset", message: "Asset missing from snapshot response." });
    // A legacy/default-mode response must never become fresh under the read-only key.
    if (!sourceValid) errors.push({ kind: "network", message: "Read-only source metadata missing or invalid." });
    if (sourceValid && ((["available", "stale"].includes(source.history.status) && (!history || source.history.data_as_of !== history.data_as_of))
      || (["available", "stale"].includes(source.forecast.status) && (!forecast || source.forecast.data_as_of !== forecast.data_as_of)))) errors.push({ kind: "network", message: "Stored data does not match its source metadata." });
    const metadataError = !sourceValid || errors.some((error) => !["unavailable"].includes("code" in error ? String(error.code) : ""));
    // Anchor remaining TTL before the request, so network/parse delay cannot extend it.
    const requestStarted = Number.isFinite(cached.value.requestedAt) ? Math.min(cached.value.requestedAt!, cached.storedAt) : cached.storedAt;
    const expiry = sourceValid ? Math.min(...[source.history, source.forecast].map((meta) => typeof meta.expires_at === "number" && Number.isFinite(meta.expires_at) ? requestStarted + meta.expires_at - queried : 0)) : 0;
    const freshUntil = Math.min(cached.storedAt + RESEARCH_FRESH_MS, expiry);
    const expired = sourceValid && ([source.history, source.forecast].some((meta) => meta.status === "stale") || freshUntil <= now);
    const status: ResearchDataEntry["status"] = metadataError || source?.query_status === "failed" || source?.history.status === "failed" || source?.forecast.status === "failed" ? "failed"
      : !history && !forecast ? "unavailable" : !history || !forecast ? "partial"
        : expired || history.data_as_of !== forecast.data_as_of ? "stale" : "fresh";
    return [symbol, { asset, history, forecast, errors, status, source,
      queryCompleted: Boolean(!cached.value.refreshError && sourceValid && source.query_status === "complete"),
      checkedAt: cached.storedAt, freshUntil,
      dataStatus: status === "fresh" ? "fresh" : "stale",
    } satisfies ResearchDataEntry];
  }));
}

/** Public market-data resource: no account state, review status or baseline writes. */
export function createResearchDataLoader(overrides: Partial<DataDependencies> = {}) {
  const deps: DataDependencies = {
    fetchBatch: getResearchSnapshotBatch,
    readCache: (path) => readOfflineResponse<CachedValue>(path),
    writeCache: writeOfflineResponse,
    now: Date.now,
    ...overrides,
  };
  const memory = new Map<string, CachedBatch>();
  const inflight = new Map<string, Promise<CachedBatch>>();

  function fetchBatch(path: string, symbols: string[], start: string): Promise<CachedBatch> {
    const current = inflight.get(path);
    if (current) return current;
    const requestedAt = deps.now();
    const pending = deps.fetchBatch(symbols, start).then((data) => {
      if (!Array.isArray(data)) throw new Error("Invalid snapshot response.");
      // A source read failure must not erase the last usable value. Retained fields
      // keep their old source dates and remain failed/unconfirmed, including after remount.
      const old = memory.get(path)?.value.data || [];
      const retained = data.map((item) => {
        const prior = old.find((value) => value.asset?.symbol === item.asset?.symbol);
        if (!prior || !item.read_only?.history || !item.read_only.forecast) return item;
        const source = { ...item.read_only };
        for (const kind of ["history", "forecast"] as const) {
          if (source[kind].status === "failed" && !item[kind] && prior[kind] && prior.read_only?.[kind]) {
            source[kind] = { ...prior.read_only[kind], status: "failed", reason: source[kind].reason };
          }
        }
        return { ...item, read_only: source,
          ...(item.read_only.history.status === "failed" && !item.history && prior.history ? { history: prior.history } : {}),
          ...(item.read_only.forecast.status === "failed" && !item.forecast && prior.forecast ? { forecast: prior.forecast } : {}),
        };
      });
      const receivedAt = deps.now();
      const cached = { value: { data: retained, requestedAt, receivedAt }, storedAt: receivedAt };
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
      if (cached?.value.receivedAt !== undefined) cached = { ...cached, storedAt: cached.value.receivedAt };
      if (cached && (!Number.isFinite(cached.storedAt) || !Array.isArray(cached.value?.data) || deps.now() - cached.storedAt > RESEARCH_STALE_MS || cached.storedAt > deps.now())) cached = null;
      if (cached) memory.set(path, cached);
      const previous = cached ? batchEntries(batch, cached, deps.now()) : null;
      if (previous) emit({ entries: previous, lastCheckedAt: cached!.storedAt });
      const completelyFresh = previous && Object.values(previous).every((entry) => entry.status === "fresh");
      const shortCached = previous && !Object.values(previous).some((entry) => entry.status === "stale") && Object.values(previous).some((entry) => ["partial", "unavailable", "failed"].includes(entry.status)) && deps.now() - (cached!.value.refreshFailedAt || cached!.storedAt) < RESEARCH_NEGATIVE_MS;
      if (!options.force && (completelyFresh || shortCached)) return;
      if (!previous) emit({ entries: Object.fromEntries(batch.map((symbol) => [symbol, { status: "loading", errors: [] }])) });
      try {
        const fresh = await fetchBatch(path, batch, start);
        emit({ entries: batchEntries(batch, fresh, deps.now()), lastCheckedAt: fresh.storedAt });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Snapshot request failed.";
        if (cached) {
          // A failed forced refresh must not become fresh again on visibility change/remount.
          // Preserve the last receipt time; this is a failure marker, not newly received data.
          const failedCache = { ...cached, value: { ...cached.value, receivedAt: cached.storedAt, refreshFailedAt: deps.now(), refreshError: message } };
          memory.set(path, failedCache);
          void deps.writeCache(path, failedCache.value).catch(() => undefined);
        }
        const entries = Object.fromEntries(batch.map((symbol) => [symbol, {
          ...previous?.[symbol],
          errors: [...(previous?.[symbol].errors || []), { kind: "network", message }],
          status: "failed" as const,
          queryCompleted: false,
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
