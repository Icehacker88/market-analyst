// Local-only synthetic workerd benchmark. No credentials, remote KV or public endpoint.
// Generate functions/api/[[path]].ts first. Optional output path writes the numeric report.
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
const result = await build({ stdin: { contents: 'import { onRequest } from "./functions/api/[[path]].ts"; export default { fetch(request, env, ctx) { return onRequest({ request, env, waitUntil: ctx.waitUntil.bind(ctx) }); } };', resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
const names = ["ORIVANE_API_CACHE", "ORIVANE_CLOUD_FORECASTS", "ORIVANE_API_METRICS", "ORIVANE_USER_STATE", "ORIVANE_AI_USAGE", "ORIVANE_ASSET_LOGOS"];
const worker = new Miniflare({ modules: true, script: result.outputFiles[0].text, compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"], inspectorPort: 0, kvNamespaces: names, outboundService() { throw new Error("Unexpected external request"); } });
let socket;
try {
  const cache = await worker.getKVNamespace(names[0]); const forecasts = await worker.getKVNamespace(names[1]);
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10), year = new Date(now).getUTCFullYear();
  const fields = ["Open", "High", "Low", "Close", "Volume", "SMA_20", "SMA_50", "SMA_200", "EMA_12", "EMA_26", "MACD", "MACD_SIGNAL", "RSI", "ATR", "BOLL_UPPER", "BOLL_LOWER", "RETURN_1D", "VOLATILITY_20D", "MOMENTUM_20D", "DRAWDOWN"];
  const records = Array.from({ length: 1250 }, (_, i) => ({ Date: new Date(now - (1250 - i) * 86400_000).toISOString().slice(0, 10), Price: 100 + i / 100, ...Object.fromEntries(fields.map((key, j) => [key, (i + 1) / (j + 1)])) }));
  const symbols = Array.from({ length: 50 }, (_, i) => `BENCH${i}`);
  let historyBytes = 0;
  for (const symbol of symbols) {
    const stored = JSON.stringify({ value: { symbol, data_source: "yahoo", data_as_of: day, records, snapshot: { latest_price: 112.5, return_1d: .01, annualized_volatility_20d: .25 } }, stored_at: new Date(now).toISOString(), expires_at: now + 30 * 60_000 }); historyBytes = Buffer.byteLength(stored);
    const key = `v3/${encodeURIComponent(`history-v5/recent-${year - 4}/${symbol}/yahoo/market`.toLowerCase()).replace(/%/g, "~")}`;
    await cache.put(key, stored);
    await forecasts.put(`forecasts/v11/${symbol}.json`, JSON.stringify({ symbol, data_as_of: day, generated_at: new Date(now).toISOString(), signal: "Up", forecast_1m_return: .05, confidence_score: 75, key_levels: { invalidation: 90 }, validation: { backtest: { samples: 120, direction_edge: 10 } }, calibration: { sample_size: 30, direction_hit_rate: 60 }, forecast_days: Array.from({ length: 22 }, () => ({ price: 115, lower: 100, upper: 130 })) }));
  }
  async function run(count, batchSize = 2, concurrency = 2) {
    const started = performance.now(); let next = 0, active = 0, maximumConcurrency = 0, firstBatchMs = null, requestCount = 0, checked = 0, bytes = 0;
    const requestMs = [];
    await Promise.all(Array.from({ length: concurrency }, async () => { while (next < count) {
      const batch = symbols.slice(next, Math.min(count, next += batchSize)); requestCount++; active++; maximumConcurrency = Math.max(maximumConcurrency, active);
      const start = performance.now(); const response = await worker.dispatchFetch(`https://test/api/market/snapshot?mode=read-only&symbols=${batch.join(",")}`);
      const text = await response.text(); active--; requestMs.push(performance.now() - start); bytes += Buffer.byteLength(text);
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      const data = JSON.parse(text).data; checked += data.filter((item) => item.read_only.history.status === "available" && item.read_only.forecast.status === "available").length;
      firstBatchMs ??= performance.now() - started;
    } }));
    requestMs.sort((a,b) => a-b);
    return { count, batchSize, requestCount, maximumConcurrency, checked, firstBatchMs, totalMs: performance.now() - started, requestMedianMs: requestMs[Math.floor(requestMs.length / 2)], requestP95Ms: requestMs[Math.min(requestMs.length - 1, Math.floor(requestMs.length * .95))], responseBytes: bytes };
  }
  const cold = await run(5); const scenarios = [];
  for (const count of [5, 20, 50]) { const samples = []; for (let repeat = 0; repeat < 5; repeat++) samples.push(await run(count)); scenarios.push({ count, samples }); }
  let profile = { available: false };
  try {
    const url = await worker.getInspectorURL(); url.protocol = "http:"; const targets = await (await fetch(new URL("/json", url))).json();
    const target = targets.find((item) => item.webSocketDebuggerUrl); if (!target) throw new Error("No inspector target");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    let nextId = 0; const pending = new Map();
    socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); if (pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); if (message.error) reject(new Error(message.error.message)); else resolve(message.result); } });
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    await send("Profiler.enable"); await send("Profiler.setSamplingInterval", { interval: 100 }); await send("Profiler.start");
    const profiledRun = await run(50, 2, 1); const { profile: cpu } = await send("Profiler.stop");
    const byId = new Map(cpu.nodes.map((node) => [node.id, node])); let nonIdleUs = 0, idleUs = 0;
    const functions = new Map();
    (cpu.samples || []).forEach((id, index) => { const name = byId.get(id)?.callFrame.functionName || "(anonymous)"; const duration = cpu.timeDeltas?.[index] || 0; if (name === "(idle)") idleUs += duration; else { nonIdleUs += duration; functions.set(name, (functions.get(name) || 0) + duration); } });
    profile = { available: true, warning: "Local V8 sampling only, includes runtime/native work and profiler overhead; NOT hosted billed CPU or a per-request quota measurement.", samplingIntervalUs: 100, samples: cpu.samples?.length, profiledRun, nonIdleSampleMs: nonIdleUs / 1000, idleSampleMs: idleUs / 1000, topFunctions: [...functions].sort((a,b) => b[1] - a[1]).slice(0, 12).map(([name, us]) => ({ name, sampledMs: us / 1000 })) };
  } catch (error) { profile = { available: false, reason: String(error) }; }
  const report = { runtime: "Miniflare 4.20260630.0 / local workerd", node: process.version, capturedAt: new Date().toISOString(), synthetic: true, historyRecordsPerAsset: records.length, historyBytesPerAsset: historyBytes, serverResponseCache: false, cold, scenarios, profile };
  console.log(JSON.stringify(report, null, 2)); if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2));
} finally { socket?.close(); await worker.dispose(); }
