// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pendingRecords from "../../contracts/pending-forecast-regressions.json";
import lateRecords from "../../contracts/late-forecast-regressions.json";
import { equitySession, followingSessions, makeEvaluationSnapshot, qualifyForecast, outcomeEligible } from "../netlify/functions/_shared/forecast-eligibility";
const root = fileURLToPath(new URL("../", import.meta.url));
const now = Date.parse("2026-10-19T00:00:00Z");
function row() {
  const generated = "2026-09-02T21:00:00Z";
  const snapshot = makeEvaluationSnapshot({ symbol: "SPY" }, { Date: "2026-09-02", Price: 100, "Adj Close": 100, Close: 100 }, "yahoo", "2026-09-02T20:30:00Z", generated);
  return { Ticker: "SPY", As_Of_Date: "2026-09-02", Created_At: generated, Evaluation_Snapshot: { ...snapshot, frozen_at: generated }, Forecast_1D_Return: .01, Action_Signal: "Up" };
}
const future = [{ Date: "2026-09-03", Price: 110, "Adj Close": 110, Close: 110 }];
const provenance = { source: "yahoo", price_basis: "Adj Close", source_observed_at: "2026-09-03T20:30:00Z" };
let worker: Miniflare;
async function call(operation: string, payload: Record<string, unknown> = {}) {
  const response = await worker.dispatchFetch("https://local.test/probe", { method: "POST", body: JSON.stringify({ operation, ...payload }) });
  expect(response.status).toBe(200);
  return await response.json() as any;
}
beforeAll(async () => {
  const source = await readFile(`${root}functions/api/[[path]].ts`, "utf8");
  const marker = "return { handle, recordCacheMetric };";
  expect(source.split(marker)).toHaveLength(2);
  const instrumented = source.replace(marker, "return { handle, recordCacheMetric, attachActualOutcomes, attachBacktestOutcomes, buildLedgerHistory, evaluateModelGovernance, reconcileCloudLedger, freezeCloudForecast };");
  const result = await build({ stdin: { contents: instrumented + `
export default { async fetch(request) {
 const input = await request.json(); const writes=[];
 const store={ get:async()=>null, setJSON:async(key,value)=>{ if(input.failWrite || input.failAt === writes.length + 1)throw new Error("synthetic storage failure"); writes.push({key,value}); }, set:async()=>{}, delete:async()=>{}, list:async()=>({blobs:[]}) };
 const api=createApi({env:{},getStore:()=>store,getDeployStore:()=>store,sendEmail:async()=>false});
 let data;
 if(input.operation==="settle") data=api.attachActualOutcomes(input.row,input.base ?? 100,input.future,input.provenance,input.now);
 if(input.operation==="history") data=api.buildLedgerHistory("SPY",input.rows,input.backtest || false);
 if(input.operation==="governance") data=api.evaluateModelGovernance("SPY",input.rows,input.previous || null);
 if(input.operation==="reconcile") data=await api.reconcileCloudLedger("SPY",input.rows);
 if(input.operation==="calendar") data={before:equitySession("2026-03-06"),after:equitySession("2026-03-09"),early:equitySession("2026-11-27")};
 if(input.operation==="freeze") { try {data=await api.freezeCloudForecast("SPY",input.forecast);}catch {data={failed:true};} }
 return Response.json({data,writes});
} };`, loader: "ts", resolveDir: `${root}functions/api` }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
  worker = new Miniflare({ modules: true, script: result.outputFiles[0].text, compatibilityDate: "2026-07-01", outboundService: () => { throw new Error("No network allowed in timing tests"); } });
}, 30000);
afterAll(async () => { await worker?.dispose(); });

describe("frozen forecast timing contract", () => {
  it("rejects every audited late record across horizons without rewriting history", () => {
    expect(lateRecords).toHaveLength(46);
    for (const r of lateRecords) for (const horizon of ["1D", "5D", "10D", "1M"]) expect(qualifyForecast(r, horizon, now).status).toBe("ineligible");
  });
  it("keeps the 22 unresolved audit cases distinct from confirmed late outcomes", () => {
    expect(pendingRecords).toHaveLength(22);
    for (const r of pendingRecords) expect(qualifyForecast(r, "1D", now).reason).toBe(!["SPY", "QQQ", "NVDA"].includes(r.Ticker) ? "unsupported_market_calendar" : "base_session_unclosed");
  });
  it("uses reviewed holidays, DST and early closes in actual workerd", async () => {
    const { data } = await call("calendar");
    expect(new Date(data.before.open).getUTCHours()).toBe(14);
    expect(new Date(data.after.open).getUTCHours()).toBe(13);
    expect(new Date(data.early.close).getUTCHours()).toBe(18);
    expect(followingSessions("2026-09-04", 1)).toEqual(["2026-09-08"]);
    expect(followingSessions("2026-07-02", 1)).toEqual(["2026-07-06"]);
    for (const day of ["2028-01-03", "2026-09-07", "2026-02-30"]) expect(equitySession(day)).toBeNull();
  });
  it("requires exact snapshot identity, source time and publication acknowledgement", () => {
    expect(qualifyForecast(row(), "1D", now).status).toBe("eligible");
    for (const [key, value, state] of [
      ["frozen_at", "2026-09-03T13:30:00Z", "ineligible"], ["source_observed_at", "2026-09-02T19:59:59Z", "ineligible"],
      ["frozen_at", null, "unknown"], ["symbol", "QQQ", "unknown"], ["price_basis", "NAV", "unknown"],
      ["target_sessions", null, "unknown"], ["source_observed_at", "2026-09-02T21:30:00Z", "unknown"],
    ] as const) {
      const r = row(); Object.assign(r.Evaluation_Snapshot, { [key]: value });
      expect(qualifyForecast(r, "1D", now).status, key).toBe(state);
    }
    expect(qualifyForecast({ ...row(), Evaluation_Snapshot: null }, "1D", now).reason).toBe("legacy_snapshot_missing");
    expect(qualifyForecast({ ...row(), Created_At: "2026-09-02T18:00:00Z" }, "1D", now).reason).toBe("base_session_unclosed");
    expect(qualifyForecast({ Ticker: "^VIX", As_Of_Date: "2026-09-04" }, "1D", now).reason).toBe("unsupported_market_calendar");
  });
  it("settles only a closed exact target on the frozen price basis and never rewrites outcomes", async () => {
    const r = row(); const { data } = await call("settle", { row: r, future, provenance, now });
    expect(data.Actual_1D_Return).toBeCloseTo(.1);
    expect(outcomeEligible(data, "1D", now)).toBe(true);
    expect(data.Evaluation_Snapshot).toEqual(r.Evaluation_Snapshot);
    const changed = await call("settle", { row: data, future: [{ ...future[0], Price: 120, "Adj Close": 120 }], base: 105, provenance, now });
    expect(changed.data.Actual_1D_Return).toBe(data.Actual_1D_Return);
    expect(changed.data.Outcome_Evidence).toEqual(data.Outcome_Evidence);
    for (const [extra, reason] of [
      [{ base: 105 }, "base_price_revised"], [{ future: [{ ...future[0], Date: "2026-09-04" }] }, "target_data_missing"],
      [{ provenance: { ...provenance, source: "stooq" } }, "price_provenance_mismatch"],
      [{ provenance: { ...provenance, source_observed_at: "2026-09-03T19:00:00Z" } }, "target_data_unconfirmed"],
      [{ provenance: { ...provenance, price_basis: "Close" } }, "price_provenance_mismatch"],
    ] as const) {
      const bad = await call("settle", { row: r, future, provenance, now, ...extra });
      expect(bad.data.Actual_1D_Return).toBeUndefined(); expect(bad.data.Settlement_Status["1D"]).toBe(reason);
    }
  });
  it("legacy reads do not fetch history, write, backfill, or count observed outcomes as qualified", async () => {
    const legacy = { ...row(), Evaluation_Snapshot: null, Actual_1D_Return: .1, Raw_Direction_Correct: 1, Actual_1D_Date: "2026-09-03", Backtest: true };
    const reconciled = await call("reconcile", { rows: [legacy] });
    expect(reconciled.data).toEqual([legacy]); expect(reconciled.writes).toEqual([]);
    const history = (await call("history", { rows: [legacy] })).data;
    expect(history.statistics[0]).toMatchObject({ observed: 1, completed: 0, excluded: 1, unknown: 1 });
    expect(history.records[0]).toMatchObject({ Verified: false, Actual_1D_Return: .1 });
    expect(history.charts.rolling_accuracy).toEqual([]);
    // Only the explicitly separate backtest call preserves simulated scoring.
    expect((await call("history", { rows: [legacy], backtest: true })).data.statistics[0].completed).toBe(1);
    const governance = (await call("governance", { rows: Array(30).fill(legacy), previous: { status: "rollback" } })).data;
    expect(governance.live_samples_all).toBe(0); expect(governance.active_model).toBe("Orivane Ensemble Safe Mode");
  });
  it("a failed forecast publication creates no ledger entry or fake acknowledgement", async () => {
    const forecast = { symbol: "SPY", data_as_of: row().As_Of_Date, generated_at: row().Created_At, evaluation_snapshot: row().Evaluation_Snapshot };
    const failed = await call("freeze", { forecast, failWrite: true });
    expect(failed.data.failed).toBe(true); expect(failed.writes).toEqual([]);
    for (const failAt of [2, 3]) {
      const partial = await call("freeze", { forecast, failAt });
      expect(partial.data.failed).toBe(true);
      expect(partial.writes).toHaveLength(failAt - 1);
      expect(partial.writes.some((write: any) => write.key.includes("ledger"))).toBe(false);
    }
    const success = await call("freeze", { forecast });
    expect(success.writes).toHaveLength(3);
    expect(success.writes[0].key).toMatch(/^publications\/time-v1\//);
    const ledger = success.writes[2].value[0];
    expect(ledger.Created_At).toBe(forecast.generated_at);
    expect(Date.parse(ledger.Evaluation_Snapshot.frozen_at)).toBeGreaterThan(Date.parse(forecast.generated_at));
    expect(qualifyForecast(ledger).status).toBe("ineligible");
  });
});
