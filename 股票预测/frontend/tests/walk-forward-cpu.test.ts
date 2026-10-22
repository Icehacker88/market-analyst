// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

// A cold `predictions/history` request runs the 120-day walk-forward backtest inline.
// On Workers Free (10 ms CPU) the original implementation took ~75 ms locally for a
// 900-day history and failed with 1102. Faster local runs do not prove the hosted
// request now fits that budget; only a measured deployment can.
//
// Contract: the optimised functions must return exactly what the originals from main
// 4933b9e (tests/fixtures/walk-forward-reference-4933b9e.txt) return in the same
// runtime. A stored digest is not portable: Math.log/exp/pow return different floats
// for some inputs on arm64 macOS than on x86-64 Linux CI, so a few rows differ between
// platforms for old and new code alike (PR #32 diagnostic runs 39724511646/39724514459).
const REFERENCE_FUNCTIONS = ["kronosKlineForecast", "historicalAnalogForecast"];
const KINDS = ["equity", "flatFund", "sparse"] as const;
type Kind = typeof KINDS[number];

const root = fileURLToPath(new URL("../", import.meta.url));
let api: any;
let reference: any;
let directory: string;

function functionDeclarations(source: string): Map<string, ts.FunctionDeclaration> {
  const tree = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = new Map<string, ts.FunctionDeclaration>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && REFERENCE_FUNCTIONS.includes(node.name.text)) found.set(node.name.text, node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

async function load(source: string, name: string) {
  const result = await build({ stdin: { contents: source, loader: "ts", resolveDir: `${root}functions/api` }, bundle: true, write: false, format: "esm", platform: "neutral", mainFields: ["module", "main"], target: "es2022" });
  const file = join(directory, `${name}.mjs`);
  await writeFile(file, result.outputFiles[0].text);
  const store = { get: async () => null, setJSON: async () => {}, set: async () => {}, delete: async () => {}, list: async () => ({ blobs: [] }) };
  return (await import(pathToFileURL(file).href)).createApi({ env: {}, getStore: () => store, getDeployStore: () => store, sendEmail: async () => false });
}

beforeAll(async () => {
  let source = await readFile(`${root}functions/api/[[path]].ts`, "utf8");
  const marker = "return { handle, recordCacheMetric };";
  expect(source.split(marker)).toHaveLength(2);
  source = source.replace(marker, "return { handle, recordCacheMetric, walkForwardEvaluationRows, trendForecast, technicalRecords, nearestAnalogs };");
  // Swap the two optimised declarations for the 4933b9e originals; everything else is shared.
  const originalText = await readFile(`${root}tests/fixtures/walk-forward-reference-4933b9e.txt`, "utf8");
  const originals = functionDeclarations(originalText);
  const current = [...functionDeclarations(source).values()];
  expect(originals.size).toBe(REFERENCE_FUNCTIONS.length);
  expect(current).toHaveLength(REFERENCE_FUNCTIONS.length);
  let referenceSource = source;
  for (const node of current.sort((left, right) => right.getStart() - left.getStart())) {
    const original = originals.get(node.name!.text)!;
    referenceSource = referenceSource.slice(0, node.getStart()) + original.getText() + referenceSource.slice(node.end);
  }
  expect(source).toContain("nearestAnalogs(neighbours, 56)");
  expect(referenceSource).not.toContain("nearestAnalogs(neighbours, 56)");
  expect(referenceSource).toContain(".slice(0, 35);");
  directory = await mkdtemp(join(tmpdir(), "orivane-walk-forward-"));
  api = await load(source, "optimised");
  reference = await load(referenceSource, "reference");
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

function fixture(kind: Kind) {
  const next = random({ equity: 7, flatFund: 11, sparse: 13 }[kind]);
  const count = { equity: 1205, flatFund: 700, sparse: 650 }[kind];
  const timestamps = tradingTimestamps(count);
  const close: number[] = [];
  let price = 100;
  for (let index = 0; index < count; index += 1) {
    // Flat NAV stretches make the local 20-day volatility zero (the fallback path) and
    // produce many equal analog distances (the tie order).
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

function trend(target: any, history: ReturnType<typeof fixture>) {
  const result = target.trendForecast(structuredClone(history));
  if (result.optimization) delete result.optimization.generated_at;
  return result;
}

// One warm-up, then the fastest of a few timed runs; input cloning is not timed.
function bestTime<T>(prepare: () => T, run: (input: T) => void, attempts = 3): number {
  run(prepare());
  let best = Infinity;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const input = prepare();
    const started = performance.now();
    run(input);
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

describe("walk-forward backtest CPU", () => {
  it.each(KINDS)("matches the original implementation exactly for %s", (kind) => {
    const history = fixture(kind);
    const actual = api.walkForwardEvaluationRows("TEST", structuredClone(history));
    expect(actual.predictions.length).toBeGreaterThan(100);
    // toStrictEqual compares numbers with Object.is: no tolerance, -0 and NaN included.
    expect(actual).toStrictEqual(reference.walkForwardEvaluationRows("TEST", structuredClone(history)));
    expect(trend(api, history)).toStrictEqual(trend(reference, history));
  }, 60000);

  it("selects nearest analogs in stable-sort order, ties included", () => {
    const next = random(17);
    for (let round = 0; round < 200; round += 1) {
      // Few distinct distances, so most cut-offs fall inside a run of equal values.
      const items = Array.from({ length: 1 + Math.floor(next() * 120) }, (_, index) => ({ index, distance: Math.floor(next() * 8) / 4 }));
      const limit = 1 + Math.floor(next() * 60);
      const expected = [...items].sort((left, right) => left.distance - right.distance).slice(0, limit);
      expect(api.nearestAnalogs(items, limit)).toStrictEqual(expected);
    }
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
      .toEqual(independent.map((item: Record<string, unknown>) => item.forecast1d));
    expect(evaluation.predictions.map((row: Record<string, unknown>) => row.Forecast_1M_Return))
      .toEqual(independent.map((item: Record<string, unknown>) => item.forecast1m));
  });

  it("is several times cheaper than the original on a 900-day history", () => {
    // 618 rows is what the production 900-day history window holds.
    const full = fixture("equity");
    const history = { ...full, records: full.records.slice(-618) };
    const prepare = () => structuredClone(history);
    const optimised = bestTime(prepare, (input) => api.walkForwardEvaluationRows("TEST", input));
    const original = bestTime(prepare, (input) => reference.walkForwardEvaluationRows("TEST", input));
    // Same process, so the ratio does not depend on the machine (~5x locally and ~10x on a
    // CI runner for 1205 rows). 2x leaves room for noisy shared CPUs; it only catches a
    // regression to the original cost, and is not evidence about the Workers CPU limit.
    console.info(`walk-forward 618 rows: original ${original.toFixed(1)} ms, optimised ${optimised.toFixed(1)} ms`);
    expect(optimised * 2).toBeLessThan(original);
  }, 60000);
});
