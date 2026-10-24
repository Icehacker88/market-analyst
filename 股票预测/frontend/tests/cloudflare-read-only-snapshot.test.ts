// @vitest-environment node
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createResearchDataLoader } from "../lib/my-research-data";
import { deriveResearchCoverage, seedResearchBaseline } from "../lib/my-research";
import type { ResearchDataEntry } from "../lib/my-research-data";
import type { MarketSnapshot } from "../lib/types";
import { CLOUD_FORECAST_POLICY_VERSION } from "../netlify/functions/_shared/forecast-eligibility";

const root = fileURLToPath(new URL("../", import.meta.url));
const bindings = ["ORIVANE_API_CACHE", "ORIVANE_CLOUD_FORECASTS", "ORIVANE_API_METRICS", "ORIVANE_USER_STATE", "ORIVANE_AI_USAGE", "ORIVANE_ASSET_LOGOS"];
const forbidden = new Set(["resolveAsset", "publicHistory", "cachedPublicHistory", "readFrozenCloudForecast", "trendForecast", "walkForwardEvaluationRows", "walkForwardPredictionRows", "cloudTrendForecast", "generateAndFreezeCloudForecast", "freezeCloudForecast", "recordCloudForecast", "readCloudLedger", "writeCloudLedger", "reconcileCloudLedger", "cloudLedgerHistory", "readModelGovernance", "evaluateModelGovernance", "persistModelGovernance"]);
let worker: Miniflare;
const outbound: string[] = [];
const day = new Date().toISOString().slice(0, 10);
const now = Date.now();
const key = (raw: string) => `v3/${encodeURIComponent(raw.toLowerCase()).replace(/%/g, "~").slice(0, 520)}`;
const historyKey = (symbol: string, type = "market") => key(`history-v5/recent-${new Date().getUTCFullYear() - 4}/${symbol}/yahoo/${type}`);
const forecastKey = (symbol: string) => `forecasts/v11/${symbol}.json`;
const history = (symbol: string, date = day) => ({ symbol, data_source: "yahoo", data_as_of: date, snapshot: { latest_price: 100, return_1d: .01, annualized_volatility_20d: .25 }, records: Array.from({ length: 1000 }, (_, index) => ({ Date: date, Price: 100 + index / 100, SMA_20: 100, SMA_50: 100, RSI: 50 })) });
const forecast = (symbol: string, date = day) => ({ symbol, data_as_of: date, policy_version: CLOUD_FORECAST_POLICY_VERSION, generated_at: new Date(now - 60_000).toISOString(), signal: "Up", forecast_1m_return: .05, confidence_score: 75, key_levels: { invalidation: 90 }, validation: { backtest: { samples: 120, direction_edge: 10 } }, calibration: { sample_size: 30, direction_hit_rate: 60 } });
async function put(binding: string, key: string, value: unknown) { await (await worker.getKVNamespace(binding) as unknown as { put(key: string, value: string): Promise<void> }).put(key, JSON.stringify(value)); }
async function seed(symbol: string, options: { market?: boolean; prediction?: boolean; age?: number; date?: string; type?: string } = {}) {
  if (options.market !== false) await put(bindings[0], historyKey(symbol, options.type), { value: history(symbol, options.date), stored_at: new Date(now - (options.age || 60_000)).toISOString(), expires_at: now - (options.age || 60_000) + 30 * 60_000 });
  if (options.prediction !== false) await put(bindings[1], forecastKey(symbol), { ...forecast(symbol, options.date), generated_at: new Date(now - (options.age || 60_000)).toISOString() });
}
async function request(symbols: string[], headers: Record<string, string> = {}) {
  const response = await worker.dispatchFetch(`https://test/api/market/snapshot?mode=read-only&symbols=${encodeURIComponent(symbols.join(","))}`, { headers });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("x-orivane-edge-cache")).toBe("BYPASS");
  const trace = JSON.parse(response.headers.get("x-test-trace")!);
  expect(trace.writes).toEqual([]);
  expect(trace.scheduledTasks).toBe(0);
  expect(trace.calls).toEqual([]);
  const result = await response.json() as { data: MarketSnapshot[] };
  return { data: result.data, trace };
}

beforeAll(async () => {
  const generated = await readFile(`${root}functions/api/[[path]].ts`, "utf8");
  const ast = ts.createSourceFile("worker.ts", generated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const insertions: { pos: number; name: string }[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && node.body && forbidden.has(node.name.text)) insertions.push({ pos: node.body.getStart(ast) + 1, name: node.name.text });
    ts.forEachChild(node, visit);
  }
  visit(ast);
  expect(new Set(insertions.map((item) => item.name))).toEqual(forbidden);
  let instrumented = generated;
  for (const { pos, name } of insertions.sort((a, b) => b.pos - a.pos)) instrumented = instrumented.slice(0, pos) + ` (globalThis as any).__calls.push(${JSON.stringify(name)}); if (!(globalThis as any).__allow) throw new Error("Forbidden read-only call: ${name}"); ` + instrumented.slice(pos);
  const result = await build({ stdin: { resolveDir: root, loader: "ts", contents: `
    import { onRequest } from "./functions/api/[[path]].ts";
    export default { async fetch(request, env, ctx) {
      const trace = { reads: [], writes: [], calls: [], scheduledTasks: 0 }; const scheduled = []; globalThis.__calls = trace.calls;
      globalThis.__allow = request.headers.get("x-test-default") === "1";
      const fail = request.headers.get("x-test-fail") || "";
      const wrapped = Object.fromEntries(Object.entries(env).map(([name, kv]) => [name, new Proxy(kv, { get(target, prop) {
        if (["put", "delete"].includes(prop)) return (...args) => { trace.writes.push([name, prop, args[0]]); return target[prop](...args); };
        if (prop === "get") return (...args) => { trace.reads.push([name, args[0]]); if (fail === "all" || (fail && args[0].toLowerCase().includes(fail))) throw new Error("Injected KV read failure"); return target.get(...args); };
        return typeof target[prop] === "function" ? target[prop].bind(target) : target[prop];
      } })]));
      const response = await onRequest({ request, env: wrapped, waitUntil(promise) { scheduled.push(promise); ctx.waitUntil(promise); } });
      await Promise.allSettled(scheduled); trace.scheduledTasks = scheduled.length;
      const headers = new Headers(response.headers); headers.set("x-test-trace", JSON.stringify(trace));
      return new Response(response.body, { status: response.status, headers });
    } };` }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
    plugins: [{ name: "readonly-call-traps", setup(build) { build.onLoad({ filter: /functions\/api\/\[\[path\]\]\.ts$/ }, () => ({ contents: instrumented, loader: "ts" })); } }],
  });
  worker = new Miniflare({ modules: true, script: result.outputFiles[0].text, compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"], kvNamespaces: bindings, outboundService(request) { outbound.push(request.url); return Response.json({ quotes: [] }); } });
}, 20_000);
afterAll(async () => { await worker?.dispose(); });

describe("generated Worker strict read-only snapshot", () => {
  it.each([5, 20, 50])("reads %i assets in pairs with maximum two requests and no model, ledger or writes", async (count) => {
    const symbols = Array.from({ length: count }, (_, index) => `READ${index}`);
    for (const symbol of symbols) await seed(symbol);
    const results: MarketSnapshot[] = []; let next = 0, requests = 0, reads = 0, active = 0, maximum = 0;
    await Promise.all(Array.from({ length: 2 }, async () => { while (next < count) {
      const pair = symbols.slice(next, next += 2); requests++; active++; maximum = Math.max(maximum, active);
      const result = await request(pair); active--; reads += result.trace.reads.length; results.push(...result.data);
    } }));
    expect(requests).toBe(Math.ceil(count / 2)); expect(maximum).toBe(2); expect(reads).toBe(count * 2);
    expect(results).toHaveLength(count); expect(results.every((item) => item.read_only?.query_status === "complete" && item.read_only.history.status === "available" && item.read_only.forecast.status === "available")).toBe(true);
    expect(results.every((item) => item.history?.records.length === 0)).toBe(true);
    expect(outbound).toEqual([]);
  });
  it.each([20, 50])("keeps exact coverage for %i mixed assets and for all-source failure", async (count) => {
    const symbols = Array.from({ length: count }, (_, index) => `${index % 5 === 4 ? "STATEFAIL" : "STATE"}${index}`);
    for (let index = 0; index < count; index++) {
      const kind = index % 5;
      if (kind !== 2) await seed(symbols[index], { prediction: kind !== 1, age: kind === 3 ? 32 * 3600_000 : 60_000 });
    }
    const entries: Record<string, ResearchDataEntry> = {}; let requests = 0;
    const load = async (fail: string) => {
      const loader = createResearchDataLoader({ readCache: async () => null, writeCache: async () => {}, fetchBatch: async (batch) => { requests++; return (await request(batch, { "x-test-fail": fail })).data; } });
      await loader.load(symbols, (update) => Object.assign(entries, update.entries));
    };
    await load("statefail");
    expect(requests).toBe(count / 2);
    expect(deriveResearchCoverage(symbols, entries)).toMatchObject({ total: count, checked: count / 5, partial: count / 5, unavailable: count / 5, stale: count / 5, failed: count / 5, unchecked: 0, queried: count * 4 / 5 });
    requests = 0; await load("all");
    expect(requests).toBe(count / 2);
    expect(deriveResearchCoverage(symbols, entries)).toMatchObject({ total: count, checked: 0, failed: count, unchecked: 0, queried: 0, unchanged: 0 });
    expect(seedResearchBaseline({}, entries)).toEqual({});
  });
  it("distinguishes market-only, forecast-only and neither; missing predictions never generate", async () => {
    await seed("ONLYH", { prediction: false }); await seed("ONLYF", { market: false });
    const { data } = await request(["ONLYH", "ONLYF", "NEITHER"]);
    expect(data.map((item) => [item.read_only?.history.status, item.read_only?.forecast.status])).toEqual([["available", "unavailable"], ["unavailable", "available"], ["unavailable", "unavailable"]]);
    expect(data.every((item) => item.read_only?.query_status === "complete")).toBe(true);
    expect(data[2].errors.map((error) => error.code)).toEqual(["unavailable", "unavailable"]);
    expect(outbound).toEqual([]);
  });
  it("isolates individual read errors and exposes all-read failure without caching or writes", async () => {
    await seed("GOOD"); await seed("BROKEN");
    let result = await request(["GOOD", "BROKEN"], { "x-test-fail": "broken" });
    expect(result.data[0].read_only?.query_status).toBe("complete");
    expect(result.data[1].read_only?.query_status).toBe("failed"); expect(result.data[1].errors).toHaveLength(2);
    result = await request(["GOOD", "BROKEN"], { "x-test-fail": "all" });
    expect(result.data.every((item) => item.read_only?.query_status === "failed" && item.errors.length === 2)).toBe(true);
    result = await request(["GOOD", "BROKEN"]);
    expect(result.data.every((item) => item.read_only?.query_status === "complete")).toBe(true);
  });
  it("retains original dates and expired ages; refreshing never renews underlying cache age", async () => {
    await seed("OLD", { age: 32 * 3600_000 });
    const first = (await request(["OLD"])).data[0]; const second = (await request(["OLD"])).data[0];
    expect(first.read_only?.history.status).toBe("stale"); expect(first.read_only?.forecast.status).toBe("stale");
    expect(second.read_only?.history).toEqual(first.read_only?.history); expect(second.read_only?.forecast).toEqual(first.read_only?.forecast);
    expect(second.history?.snapshot.latest_price).toBe(100);
    await seed("OLDDATE", { date: "2020-01-01" });
    const oldDate = (await request(["OLDDATE"])).data[0];
    expect(oldDate.read_only?.history.status).toBe("stale"); expect(oldDate.read_only?.forecast.status).toBe("stale");
    expect(oldDate.history?.data_as_of).toBe("2020-01-01");
    expect(oldDate.read_only?.history.stored_at).not.toBeNull();
  });
  it("rejects malformed stored records and marks unknown ages/date mismatch conservatively", async () => {
    await seed("INVALID"); await put(bindings[1], forecastKey("INVALID"), { ...forecast("WRONG"), forecast_1m_return: null });
    expect((await request(["INVALID"])).data[0].read_only?.forecast.status).toBe("failed");
    await seed("UNDATED"); await put(bindings[1], forecastKey("UNDATED"), { ...forecast("UNDATED"), generated_at: undefined });
    expect((await request(["UNDATED"])).data[0].read_only?.forecast.status).toBe("stale");
    await seed("MISMATCH"); await put(bindings[1], forecastKey("MISMATCH"), forecast("MISMATCH", new Date(now - 86400_000).toISOString().slice(0, 10)));
    expect((await request(["MISMATCH"])).data[0].read_only?.forecast.reason).toBe("market_date_mismatch");
  });
  it("reports another or missing policy version as stale Observe without generating, writing or fetching", async () => {
    for (const [symbol, version] of [["OLDPOLICY", "cloud-forecast-policy-v0"], ["NOPOLICY", undefined]] as const) {
      await seed(symbol);
      const stored: Record<string, unknown> = { ...forecast(symbol), signal: "Up", model_governance: { status: "stable", active_model: "Orivane Horizon Router", evidence_gate: { status: "met", samples: 80, required: 60 } } };
      if (version) stored.policy_version = version; else delete stored.policy_version;
      await put(bindings[1], forecastKey(symbol), stored);
      const before = outbound.length;
      const { data } = await request([symbol]);
      expect(data[0].read_only?.forecast).toMatchObject({ status: "stale", reason: "policy_version_mismatch" });
      expect(data[0].forecast?.signal).toBe("Observe");
      expect(outbound.length).toBe(before);
    }
  });
  it("never serves scoreboard evidence cached under another policy version", async () => {
    const entry = (marker: string) => ({ value: { scope: marker, live: { statistics: [{ window: "All", completed: 60, direction_accuracy: 80 }] } }, stored_at: new Date().toISOString(), expires_at: Date.now() + 3_600_000 });
    await put(bindings[0], key("forecast/public-scoreboard-time-v1"), entry("OLD-POLICY-SENTINEL"));
    const stale = await worker.dispatchFetch("https://test/api/forecast/scoreboard?v=3&contract=frozen-close-v1&probe=old", { headers: { "x-test-default": "1" } });
    expect(await stale.text()).not.toContain("OLD-POLICY-SENTINEL");
    await put(bindings[0], key(`forecast/public-scoreboard-time-v1/${CLOUD_FORECAST_POLICY_VERSION}`), entry("CURRENT-POLICY-SENTINEL"));
    const current = await worker.dispatchFetch("https://test/api/forecast/scoreboard?v=3&contract=frozen-close-v1&probe=current", { headers: { "x-test-default": "1" } });
    expect(await current.text()).toContain("CURRENT-POLICY-SENTINEL");
    const cache = await worker.getKVNamespace(bindings[0]) as unknown as { delete(key: string): Promise<void> };
    await cache.delete(key("forecast/public-scoreboard-time-v1"));
    await cache.delete(key(`forecast/public-scoreboard-time-v1/${CLOUD_FORECAST_POLICY_VERSION}`));
  });
  it("never serves a batch snapshot with forecasts cached under another policy version", async () => {
    const cache = await worker.getKVNamespace(bindings[0]) as unknown as { delete(key: string): Promise<void> };
    const entry = (marker: string) => ({ value: [{ asset: { symbol: "SPY" }, forecast: { symbol: "SPY", policy_version: marker, signal: "Up", action: { actionable: true } }, errors: [] }], stored_at: new Date().toISOString(), expires_at: Date.now() + 3_600_000 });
    const oldKey = key("market/snapshot-v1/all/lite/2025-01-01/SPY"), currentKey = key(`market/snapshot-v1/all/lite/2025-01-01/SPY/${CLOUD_FORECAST_POLICY_VERSION}`);
    await put(bindings[0], oldKey, entry("OLD-POLICY-BATCH"));
    const stale = await worker.dispatchFetch("https://test/api/market/snapshot?symbols=SPY&include=all&probe=old", { headers: { "x-test-default": "1" } });
    expect(await stale.text()).not.toContain("OLD-POLICY-BATCH");
    await put(bindings[0], currentKey, entry("CURRENT-POLICY-BATCH"));
    const current = await worker.dispatchFetch("https://test/api/market/snapshot?symbols=SPY&include=all&probe=current", { headers: { "x-test-default": "1" } });
    expect(await current.text()).toContain("CURRENT-POLICY-BATCH");
    await cache.delete(oldKey); await cache.delete(currentKey);
  });
  it("isolates malformed guard evidence instead of failing the entire batch", async () => {
    await seed("GUARDFAIL"); await seed("GUARDOK");
    await put(bindings[1], forecastKey("GUARDFAIL"), { ...forecast("GUARDFAIL"), horizon_models: [null] });
    const { data } = await request(["GUARDFAIL", "GUARDOK"]);
    expect(data[0].read_only?.forecast).toMatchObject({ status: "failed", reason: "stored_forecast_guard_failed" });
    expect(data[0].history).toBeDefined(); expect(data[0].forecast).toBeUndefined();
    expect(data[1].read_only?.query_status).toBe("complete");
  });
  it("bypasses legacy snapshot caches, remains no-store, and manual reread sees source updates", async () => {
    await seed("REREAD"); await request(["REREAD"]);
    await put(bindings[0], historyKey("REREAD"), { value: { ...history("REREAD"), snapshot: { latest_price: 123 } }, stored_at: new Date().toISOString(), expires_at: Date.now() + 30 * 60_000 });
    expect((await request(["REREAD"])).data[0].history?.snapshot.latest_price).toBe(123);
    const cache = await worker.getKVNamespace(bindings[0]) as unknown as { list(): Promise<{ keys: { name: string }[] }> };
    const list = await cache.list(); expect(list.keys.every((item) => item.name.includes("history-v5"))).toBe(true);
  });
  it("keeps default history-only snapshot semantics and records, without opt-in metadata", async () => {
    await seed("NVDA", { type: "stock" });
    const response = await worker.dispatchFetch(`https://test/api/market/snapshot?symbols=NVDA&include=history&view=lite&start=${day}`, { headers: { "x-test-default": "1" } });
    expect(response.status).toBe(200);
    const data = (await response.json() as { data: MarketSnapshot[] }).data[0];
    expect(data.read_only).toBeUndefined(); expect(data.history?.records).toHaveLength(1000); expect(data.forecast).toBeUndefined(); expect(data.errors).toEqual([]);
    const trace = JSON.parse(response.headers.get("x-test-trace")!);
    expect(trace.calls).toContain("cachedPublicHistory"); expect(trace.writes.some((item: string[]) => item[0] === bindings[0])).toBe(true);
  });
  it("rejects invalid mode, malformed symbols and oversized read-only requests", async () => {
    for (const query of ["mode=typo&symbols=NVDA", "mode=read-only&symbols=", "mode=read-only&symbols=A,B,C,D,E", "mode=read-only&symbols=A/B"]) {
      expect((await worker.dispatchFetch(`https://test/api/market/snapshot?${query}`)).status).toBe(422);
    }
  });
});
