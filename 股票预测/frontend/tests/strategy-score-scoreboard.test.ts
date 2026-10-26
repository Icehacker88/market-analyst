// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import ts from "typescript";

// The real generated Worker's forecastScoreboard, with only the price provider (and ledger,
// governance, Kronos reads) replaced. History rows go through the real technicalRecords.
const root = fileURLToPath(new URL("../", import.meta.url));
let worker: Miniflare;

beforeAll(async () => {
  let source = await readFile(`${root}functions/api/[[path]].ts`, "utf8");
  const tree = ts.createSourceFile("worker.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits: Array<{ start: number; end: number; body: string }> = [];
  const stubs: Record<string, string> = {
    cloudLedgerHistory: "{ return null; }",
    readModelGovernance: "{ return null; }",
    readOfficialKronos: "{ return null; }",
    // Sessions from 2026-01-02 through the test's last day; the last bar is +10% so its inclusion shows.
    publicHistory: `{
      const days = []; let day = "2026-01-02";
      while (day <= testInput.lastDay) { days.push(day); day = __followingSessions(day, 1)[0]; }
      const close = days.map((_, i) => i === days.length - 1 ? 100 * 1.1 : 100 * (1 + 0.01 * Math.sin(i / 3)));
      const timestamps = days.map((d) => Date.parse(d + "T14:30:00Z") / 1000);
      const quote = { open: close, high: close, low: close, close, volume: close.map(() => 1e6) };
      const records = technicalRecords(timestamps, quote, close);
      return { symbol, data_source: "yahoo", source_observed_at: testInput.observed, data_as_of: days.at(-1), snapshot: { latest_price: close.at(-1) }, records };
    }`,
  };
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.body && node.name && stubs[node.name.text]) edits.push({ start: node.body.getStart(tree), end: node.body.end, body: stubs[node.name.text] });
    ts.forEachChild(node, visit);
  }
  visit(tree);
  expect(edits).toHaveLength(4);
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.body + source.slice(edit.end);
  source = source.replace("return { handle, recordCacheMetric };", "return { handle, recordCacheMetric, forecastScoreboard };");
  const result = await build({ stdin: { contents: source + `
import { followingSessions as __followingSessions } from "../../netlify/functions/_shared/forecast-eligibility";
const RealDate = Date; let testNow = 0, testInput;
globalThis.Date = class extends RealDate { constructor(...args) { if (args.length) super(...args); else super(testNow); } static now() { return testNow; } };
export default { async fetch(request) {
  testInput = await request.json(); testNow = Date.parse(testInput.now);
  const values = new Map();
  const store = { get: async (k) => values.has(k) ? structuredClone(values.get(k)) : null, setJSON: async (k, v) => { values.set(k, structuredClone(v)); }, set: async () => {}, delete: async () => {}, list: async () => ({ blobs: [] }) };
  const api = createApi({ env: {}, getStore: () => store, getDeployStore: () => store, sendEmail: async () => false });
  let board; try { board = await api.forecastScoreboard(); } catch (error) { return Response.json({ error: String(error && error.stack || error) }, { status: 500 }); }
  return Response.json(board.per_asset.map((asset) => ({ symbol: asset.symbol, backtest: asset.strategy.backtest, live: asset.strategy.live })));
} };`, loader: "ts", resolveDir: `${root}functions/api` }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
  worker = new Miniflare({ modules: true, script: result.outputFiles[0].text, compatibilityDate: "2026-07-01", outboundService: () => { throw new Error("Network forbidden"); } });
}, 60000);
afterAll(async () => { await worker?.dispose(); });

async function board(payload: { now: string; observed: string; lastDay: string }) {
  const response = await worker.dispatchFetch("https://local.test/", { method: "POST", body: JSON.stringify(payload) });
  if (response.status !== 200) throw new Error(await response.text());
  return (await response.json() as Array<{ symbol: string; backtest: any; live: any }>)[0];
}

describe("scoreboard strategy scoring uses confirmed closes only", () => {
  it("leaves out today's bar while the session is open", async () => {
    const spy = await board({ now: "2026-10-23T15:00:00Z", observed: "2026-10-23T15:00:00Z", lastDay: "2026-10-23" });
    expect([spy.backtest.status, spy.backtest.end_target]).toEqual(["ok", "2026-10-22"]);
    expect(spy.live.status).toBe("no_data");
  });

  it("still leaves it out after the close when the history is an intraday cache", async () => {
    const spy = await board({ now: "2026-10-23T20:30:00Z", observed: "2026-10-23T15:00:00Z", lastDay: "2026-10-23" });
    expect(spy.backtest.end_target).toBe("2026-10-22");
  });

  it("includes the day once a fetch at least 15 minutes after the close confirms it", async () => {
    const before = await board({ now: "2026-10-23T20:30:00Z", observed: "2026-10-23T15:00:00Z", lastDay: "2026-10-23" });
    const after = await board({ now: "2026-10-23T20:30:00Z", observed: "2026-10-23T20:20:00Z", lastDay: "2026-10-23" });
    expect(after.backtest.end_target).toBe("2026-10-23");
    const hold = (side: any) => side.backtest.strategies.find((item: any) => item.key === "buy_hold").return_gross;
    expect(hold(after)).toBeGreaterThan(hold(before) + .05); // the +10% last bar only counts once confirmed
  });

  it("uses the reviewed early close", async () => {
    const early = await board({ now: "2026-11-27T18:10:00Z", observed: "2026-11-27T18:10:00Z", lastDay: "2026-11-27" });
    expect(early.backtest.end_target).toBe("2026-11-25");
    const confirmed = await board({ now: "2026-11-27T18:20:00Z", observed: "2026-11-27T18:20:00Z", lastDay: "2026-11-27" });
    expect(confirmed.backtest.end_target).toBe("2026-11-27");
  });
});
