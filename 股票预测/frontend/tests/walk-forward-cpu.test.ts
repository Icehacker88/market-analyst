// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// A cold `predictions/history` request runs the 120-day walk-forward backtest inline.
// On Workers Free (10 ms CPU) the original implementation took ~75 ms for a 900-day
// history and failed with 1102. These digests were captured from that implementation
// (main 4933b9e); the optimisation must keep every forecast and outcome byte-identical.
// Change them only together with an intentional model change.
const GOLDEN: Record<"equity" | "flatFund" | "sparse", { walkForward: string; trend: string }> = {
  equity: { walkForward: "3110bef941787e6eadc47dba913caf47", trend: "1badabd24ce0756d4ae8e172f5dc2e91" },
  flatFund: { walkForward: "f73b61e12e55ef6e46f5938ba39dcd08", trend: "07279008f4e57fb8885738a3a2b5b0be" },
  sparse: { walkForward: "e74493f022aab68752b1aa8463117060", trend: "648e6590a7f5f393df04195be73970ef" },
};

const root = fileURLToPath(new URL("../", import.meta.url));
let api: any;
let directory: string;

beforeAll(async () => {
  let source = await readFile(`${root}functions/api/[[path]].ts`, "utf8");
  const marker = "return { handle, recordCacheMetric };";
  expect(source.split(marker)).toHaveLength(2);
  source = source.replace(marker, "return { handle, recordCacheMetric, walkForwardEvaluationRows, trendForecast, technicalRecords };");
  const result = await build({ stdin: { contents: source, loader: "ts", resolveDir: `${root}functions/api` }, bundle: true, write: false, format: "esm", platform: "neutral", mainFields: ["module", "main"], target: "es2022" });
  directory = await mkdtemp(join(tmpdir(), "orivane-walk-forward-"));
  const file = join(directory, "worker.mjs");
  await writeFile(file, result.outputFiles[0].text);
  const store = { get: async () => null, setJSON: async () => {}, set: async () => {}, delete: async () => {}, list: async () => ({ blobs: [] }) };
  api = (await import(pathToFileURL(file).href)).createApi({ env: {}, getStore: () => store, getDeployStore: () => store, sendEmail: async () => false });
}, 30000);
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function tradingTimestamps(count: number): number[] {
  const timestamps: number[] = [];
  for (let day = Date.UTC(2022, 0, 3); timestamps.length < count; day += 86400000) {
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) timestamps.push(day / 1000 + 20 * 3600);
  }
  return timestamps;
}

function fixture(kind: keyof typeof GOLDEN) {
  const next = random({ equity: 7, flatFund: 11, sparse: 13 }[kind]);
  const count = { equity: 1205, flatFund: 700, sparse: 650 }[kind];
  const timestamps = tradingTimestamps(count);
  const close: number[] = [];
  let price = 100;
  for (let index = 0; index < count; index += 1) {
    // Flat NAV stretches make the local 20-day volatility zero and exercise the fallback.
    const flat = kind === "flatFund" && index % 160 >= 100;
    if (!flat) price *= 1 + (next() - 0.49) * 0.04;
    close.push(Number(price.toFixed(kind === "flatFund" ? 2 : 4)));
  }
  const open = close.map((value, index) => index ? close[index - 1] * (1 + (next() - 0.5) * 0.01) : value);
  const high = close.map((value, index) => Math.max(value, open[index]) * (1 + next() * 0.01));
  const low = close.map((value, index) => Math.min(value, open[index]) * (1 - next() * 0.01));
  const volume = close.map(() => kind === "flatFund" ? null : Math.round(1e6 + next() * 5e6));
  const records = api.technicalRecords(timestamps, kind === "flatFund"
    ? { open: close, high: close, low: close, close, volume }
    : { open, high, low, close, volume }, close);
  if (kind === "sparse") records.forEach((row: Record<string, unknown>, index: number) => {
    if (index % 17 === 0) row.Volume = null;
    if (index % 23 === 0) { row.High = null; row.Low = null; }
    if (index % 29 === 0) row.Close = null;
    if (index % 31 === 0) row.MA_50 = null;
  });
  return { records, snapshot: { latest_price: close.at(-1), annualized_volatility_20d: kind === "flatFund" ? null : 0.3 } };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

function trendDigest(history: ReturnType<typeof fixture>): string {
  const trend = api.trendForecast(structuredClone(history));
  if (trend.optimization) delete trend.optimization.generated_at;
  return digest(trend);
}

describe("walk-forward backtest CPU", () => {
  it.each(Object.keys(GOLDEN) as Array<keyof typeof GOLDEN>)("keeps %s output identical to the original implementation", (kind) => {
    const history = fixture(kind);
    const evaluation = api.walkForwardEvaluationRows("TEST", structuredClone(history));
    expect(evaluation.predictions.length).toBeGreaterThan(100);
    expect({ walkForward: digest(evaluation), trend: trendDigest(history) }).toEqual(GOLDEN[kind]);
  });

  it("reuses analog vectors only for the same row prefix", () => {
    const history = fixture("sparse");
    const rows = [...history.records];
    // Each walk-forward step must equal an independent forecast on that prefix.
    const evaluation = api.walkForwardEvaluationRows("TEST", { records: rows }, 5);
    const independent = rows.slice(-6, -1).map((row: Record<string, unknown>, offset: number) => {
      const past = rows.slice(0, rows.length - 6 + offset + 1);
      const price = Number(row.Price);
      const std = Number(row.Rolling_Std_20);
      return api.trendForecast({ snapshot: { latest_price: price, annualized_volatility_20d: Number.isFinite(std) ? std * Math.sqrt(252) : null }, records: structuredClone(past) });
    });
    expect(evaluation.predictions.map((row: Record<string, unknown>) => row.Forecast_1D_Return))
      .toEqual(independent.map((trend: Record<string, unknown>) => trend.forecast1d));
    expect(evaluation.predictions.map((row: Record<string, unknown>) => row.Forecast_1M_Return))
      .toEqual(independent.map((trend: Record<string, unknown>) => trend.forecast1m));
  });

  it("stays well inside the old cost for a 1205-day history", () => {
    const history = fixture("equity");
    let best = Infinity;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const input = structuredClone(history);
      const started = performance.now();
      api.walkForwardEvaluationRows("TEST", input);
      best = Math.min(best, performance.now() - started);
    }
    // Local Node: ~160 ms before, ~20 ms after. The ceiling only catches a regression.
    console.info(`walk-forward 1205 rows: best ${best.toFixed(1)} ms`);
    expect(best).toBeLessThan(100);
  });
});
