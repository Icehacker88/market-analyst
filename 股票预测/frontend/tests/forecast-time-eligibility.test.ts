// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pendingRecords from "../../contracts/pending-forecast-regressions.json";
import lateRecords from "../../contracts/late-forecast-regressions.json";
import { CLOUD_FORECAST_POLICY_VERSION, equitySession, followingSessions, makeEvaluationSnapshot, qualifyForecast, outcomeEligible, wilsonInterval } from "../netlify/functions/_shared/forecast-eligibility";
const root = fileURLToPath(new URL("../", import.meta.url));
const now = Date.parse("2026-10-19T00:00:00Z");
function row() {
  const generated = "2026-09-02T21:00:00Z";
  const snapshot = makeEvaluationSnapshot({ symbol: "SPY" }, { Date: "2026-09-02", Price: 100, "Adj Close": 100, Close: 100 }, "yahoo", "2026-09-02T20:30:00Z", generated);
  return { Ticker: "SPY", As_Of_Date: "2026-09-02", Created_At: generated, Evaluation_Snapshot: { ...snapshot, frozen_at: generated }, Forecast_1D_Return: .01, Action_Signal: "Up" };
}
const future = [{ Date: "2026-09-03", Price: 110, "Adj Close": 110, Close: 110 }];
// A settled, time-qualified, current-version 1D record for base session `day`.
function scored(day: string, actual: number, hit: boolean, version: string | null = CLOUD_FORECAST_POLICY_VERSION) {
  const target = followingSessions(day, 1)[0], close = equitySession(day)!.close, targetClose = equitySession(target)!.close;
  const observed = new Date(close + 20 * 60000).toISOString(), generated = new Date(close + 30 * 60000).toISOString();
  const snapshot = makeEvaluationSnapshot({ symbol: "SPY" }, { Date: day, Price: 100, "Adj Close": 100, Close: 100 }, "yahoo", observed, generated);
  const forecastReturn = hit === (actual >= 0) ? .001 : -.001;
  return { Ticker: "SPY", As_Of_Date: day, Created_At: generated, Policy_Version: version, Evaluation_Snapshot: { ...snapshot, frozen_at: generated },
    Forecast_1D_Return: forecastReturn, Actual_1D_Return: actual, Actual_1D_Date: target, Actual_1D_Direction: actual >= 0 ? "Up" : "Down",
    Raw_Direction_Correct: hit ? 1 : 0, Absolute_Return_Error: Math.abs(actual - forecastReturn), Settlement_Status: { "1D": "settled" },
    Outcome_Evidence: { "1D": { source: "yahoo", price_basis: "Close", base_price: 100, actual_price: 100 * (1 + actual), target_session: target, source_observed_at: new Date(targetClose + 20 * 60000).toISOString(), settled_at: new Date(targetClose + 30 * 60000).toISOString() } } };
}
// `n` consecutive sessions from 2026-03-02, alternating up/down days (50% majority baseline),
// with the first `hits` correct unless a hit pattern is given.
function series(n: number, hitAt: (index: number) => boolean) {
  const days: string[] = []; let day = "2026-02-27";
  while (days.length < n) { day = followingSessions(day, 1)[0]; days.push(day); }
  return days.map((d, i) => scored(d, i % 2 ? -.01 : .01, hitAt(i)));
}
const provenance = { source: "yahoo", price_basis: "Close", source_observed_at: "2026-09-03T20:30:00Z" };
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
  const instrumented = source.replace(marker, "return { handle, recordCacheMetric, attachActualOutcomes, attachBacktestOutcomes, buildLedgerHistory, evaluateModelGovernance, reconcileCloudLedger, freezeCloudForecast, recordCloudForecast, buildForecastAction };");
  const result = await build({ stdin: { contents: instrumented + `
export default { async fetch(request) {
 const input = await request.json(); const writes=[];
 const store={ get:async(key)=>key.includes("ledger") ? (input.rows || []) : null, setJSON:async(key,value)=>{ if(input.failWrite || input.failAt === writes.length + 1)throw new Error("synthetic storage failure"); writes.push({key,value}); }, set:async()=>{}, delete:async()=>{}, list:async()=>({blobs:[]}) };
 const api=createApi({env:{},getStore:()=>store,getDeployStore:()=>store,sendEmail:async()=>false});
 let data;
 if(input.operation==="settle") data=api.attachActualOutcomes(input.row,input.base ?? 100,input.future,input.provenance,input.now);
 if(input.operation==="history") data=api.buildLedgerHistory("SPY",input.rows,input.backtest || false);
 if(input.operation==="governance") data=api.evaluateModelGovernance("SPY",input.rows,input.previous || null);
 if(input.operation==="action") { const g=api.evaluateModelGovernance("SPY",input.rows,null); data={governance:g,action:api.buildForecastAction(.05,80,{support:95,resistance:110,stop_loss:90,breakout:111,invalidation:90,invalidation_zh:"",invalidation_en:""},{backtest_samples:100,backtest_edge:10,calibration_samples:30,calibration_hit_rate:65,live_samples:0,live_edge:null,live_gate:g.evidence_gate,governance_status:g.status,fresh:true})}; }
 if(input.operation==="reconcile") data=await api.reconcileCloudLedger("SPY",input.rows);
 if(input.operation==="calendar") data={before:equitySession("2026-03-06"),after:equitySession("2026-03-09"),early:equitySession("2026-11-27")};
 if(input.operation==="record") { await api.recordCloudForecast("SPY",input.forecast,input.frozenAt,input.publicationId); data=true; }
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
      ["frozen_at", null, "unknown"], ["symbol", "QQQ", "unknown"], ["price_basis", "NAV", "unknown"], ["price_basis", "Adj Close", "unknown"],
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
      [{ provenance: { ...provenance, price_basis: "Adj Close" } }, "price_provenance_mismatch"],
    ] as const) {
      const bad = await call("settle", { row: r, future, provenance, now, ...extra });
      expect(bad.data.Actual_1D_Return).toBeUndefined(); expect(bad.data.Settlement_Status["1D"]).toBe(reason);
    }
  });
  it("tolerates float noise and cent-level finalization of the base close, but still flags revisions", async () => {
    // Base frozen at 100 (for example Yahoo's after-close meta price); settlement re-reads the finalized bar.
    for (const [base, reason] of [[100.0000149, "settled"], [100.009, "settled"], [99.991, "settled"], [100.02, "base_price_revised"], [50, "base_price_revised"]] as const) {
      const { data } = await call("settle", { row: row(), future, provenance, now, base });
      expect(data.Settlement_Status["1D"], String(base)).toBe(reason);
      if (reason === "settled") {
        expect(data.Actual_1D_Return).toBeCloseTo(.1); // still measured from the frozen base, not the re-read one
        expect(data.Outcome_Evidence["1D"].base_price).toBe(100);
        expect(outcomeEligible(data, "1D", now)).toBe(true);
      }
    }
  });
  it("freezes and settles on the unadjusted Close so ex-dividend Adj Close rewrites cannot strand a record", async () => {
    const snapshot = makeEvaluationSnapshot({ symbol: "SPY" }, { Date: "2026-09-02", Price: 98.5, "Adj Close": 98.5, Close: 100 }, "yahoo", "2026-09-02T20:30:00Z", "2026-09-02T21:00:00Z");
    expect([snapshot.price_basis, snapshot.base_price]).toEqual(["Close", 100]);
    // Ex-dividend on the target day: the adjusted series differs from Close, settlement still uses Close.
    const dividendDay = [{ Date: "2026-09-03", Price: 109.67, "Adj Close": 109.67, Close: 110 }];
    const { data } = await call("settle", { row: row(), future: dividendDay, provenance, now });
    expect(data.Actual_1D_Return).toBeCloseTo(.1);
    expect(data.Outcome_Evidence["1D"]).toMatchObject({ price_basis: "Close", base_price: 100, actual_price: 110 });
    expect(outcomeEligible(data, "1D", now)).toBe(true);
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
  it("appends the first eligible same-day publication without overwriting intraday or legacy evidence", async () => {
    const forecast = { symbol: "SPY", data_as_of: row().As_Of_Date, generated_at: row().Created_At,
      evaluation_snapshot: row().Evaluation_Snapshot, forecast_1d_return: .02, policy_version: CLOUD_FORECAST_POLICY_VERSION };
    const intraday = { ...row(), Created_At: "2026-09-02T18:00:00Z", Evaluation_Snapshot: null,
      Actual_1D_Return: .1, Raw_Direction_Correct: 1, Publication_ID: "old" };
    for (const existing of [intraday, { ...intraday, Created_At: row().Created_At }]) {
      const original = structuredClone(existing);
      const first = await call("record", { rows: [existing], forecast, frozenAt: row().Created_At, publicationId: "qualified" });
      expect(first.writes).toHaveLength(1);
      const records = first.writes[0].value;
      expect(records).toHaveLength(2);
      expect(records[0]).toEqual(original);
      expect(qualifyForecast(records[1]).status).toBe("eligible");
      expect(records[1].Policy_Version).toBe(CLOUD_FORECAST_POLICY_VERSION);
      for (const horizon of ["1D", "5D", "10D", "1M"]) expect(qualifyForecast(records[1], horizon).status).toBe("eligible");
      // A retry or a later, different forecast cannot replace the accepted publication.
      for (const generated_at of [row().Created_At, "2026-09-03T12:00:00Z"]) {
        const candidate = { ...forecast, generated_at, forecast_1d_return: -.5,
          evaluation_snapshot: { ...forecast.evaluation_snapshot, generated_at, frozen_at: generated_at } };
        expect(qualifyForecast({ ...row(), Created_At: generated_at, Evaluation_Snapshot: candidate.evaluation_snapshot }).status).toBe("eligible");
        const retry = await call("record", { rows: records, forecast: candidate,
          frozenAt: generated_at, publicationId: "retry" });
        expect(retry.writes).toEqual([]);
      }
      const history = (await call("history", { rows: records })).data;
      expect(history.statistics[0]).toMatchObject({ eligible: 1, completed: 0, observed: 1, excluded: 1 });
      const settled = (await call("settle", { row: records[1], future, provenance, now })).data;
      const after = (await call("history", { rows: [original, settled] })).data;
      expect(after.statistics[0]).toMatchObject({ eligible: 1, completed: 1, observed: 2, excluded: 1 });
      expect((await call("record", { rows: [original, settled], forecast,
        frozenAt: row().Created_At, publicationId: "after-settlement" })).writes).toEqual([]);
    }
  });
  it("counts only settled outcomes generated under the current policy version", async () => {
    const settled = (await call("settle", { row: { ...row(), Policy_Version: CLOUD_FORECAST_POLICY_VERSION }, future, provenance, now })).data;
    expect(outcomeEligible(settled, "1D", now)).toBe(true);
    const older = { ...settled, Policy_Version: "cloud-forecast-policy-v0" };
    const legacy = { ...settled };
    delete legacy.Policy_Version;
    const history = (await call("history", { rows: [settled, older, legacy] })).data;
    expect(history.statistics[0]).toMatchObject({ completed: 1, eligible: 3, excluded: 2, other_policy: 2, policy_version: CLOUD_FORECAST_POLICY_VERSION });
    expect(history.records.map((r: any) => [r.Policy_Current, r.Verified])).toEqual([[true, true], [false, false], [false, false]]);
    expect(history.charts.rolling_accuracy).toHaveLength(1);
    // Other-version evidence never unlocks the current policy, however much of it exists.
    const governance = (await call("governance", { rows: Array(30).fill(older) })).data;
    expect(governance.live_samples_all).toBe(0);
    expect(governance.active_model).toBe("Orivane Ensemble Safe Mode");
  });
  it("copies the generation-time policy version into the ledger and never stamps one at write time", async () => {
    const base = { symbol: "SPY", data_as_of: row().As_Of_Date, generated_at: row().Created_At, evaluation_snapshot: row().Evaluation_Snapshot, forecast_1d_return: .02 };
    const unversioned = await call("record", { rows: [], forecast: base, frozenAt: row().Created_At, publicationId: "p1" });
    expect(unversioned.writes[0].value[0].Policy_Version).toBeNull();
    const older = await call("record", { rows: [], forecast: { ...base, policy_version: "cloud-forecast-policy-v0" }, frozenAt: row().Created_At, publicationId: "p2" });
    expect(older.writes[0].value[0].Policy_Version).toBe("cloud-forecast-policy-v0");
  });
  it("computes the Wilson 95% interval", () => {
    const interval = wilsonInterval(56, 80)!;
    expect(interval.low).toBeCloseTo(59.22, 1);
    expect(interval.high).toBeCloseTo(78.92, 1);
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(wilsonInterval(60, 60)!.high).toBeCloseTo(100, 9);
  });
  it("keeps Safe Mode until the per-asset, current-version evidence gate is met", async () => {
    const governance = async (rows: unknown[], previous: unknown = null) => (await call("governance", { rows, previous })).data;
    // 59 perfect outcomes: not enough samples.
    const short = await governance(series(59, () => true));
    expect(short.evidence_gate).toMatchObject({ status: "insufficient", samples: 59, required: 60 });
    expect([short.status, short.active_model]).toEqual(["warming_up", "Orivane Ensemble Safe Mode"]);
    expect(short.reason_zh).toContain("59/60");
    // 60 outcomes at 60% vs a 50% baseline: lower bound ~47.4% is not above 50%.
    const notMet = await governance(series(60, (i) => i % 5 < 3));
    expect(notMet.evidence_gate.status).toBe("not_met");
    expect(notMet.evidence_gate.ci_low).toBeLessThan(notMet.evidence_gate.majority_baseline_accuracy);
    expect([notMet.status, notMet.active_model]).toEqual(["warming_up", "Orivane Ensemble Safe Mode"]);
    // 80 outcomes at 70%: lower bound ~59.2% beats 50%.
    const met = await governance(series(80, (i) => i % 10 < 7));
    expect(met.evidence_gate).toMatchObject({ status: "met", samples: 80, hits: 56 });
    expect([met.status, met.active_model]).toEqual(["stable", "Orivane Horizon Router"]);
  });
  it("lets protective rollback precede the gate but never lets watch bypass it", async () => {
    // Former behaviour: 20+ samples with zero edge put the asset on watch, running the Router.
    const flat = await (await call("governance", { rows: series(40, (i) => i % 2 === 0) })).data;
    expect([flat.status, flat.active_model]).toEqual(["warming_up", "Orivane Ensemble Safe Mode"]);
    // Gate met overall, but the latest 20 collapse: rollback wins.
    const collapsed = await (await call("governance", { rows: series(100, (i) => i < 80 ? i % 10 < 9 : false) })).data;
    expect(collapsed.evidence_gate.status).toBe("met");
    expect([collapsed.status, collapsed.active_model]).toEqual(["rollback", "Orivane Ensemble Safe Mode"]);
  });
  it("generation-path action follows governance: rollback never acts even when the overall gate is met", async () => {
    const collapsed = (await call("action", { rows: series(100, (i) => i < 80 ? i % 10 < 9 : false) })).data;
    expect([collapsed.governance.status, collapsed.governance.evidence_gate.status]).toEqual(["rollback", "met"]);
    expect(collapsed.action.actionable).toBe(false);
    expect(collapsed.action.summary_zh).toContain("模型已回退到保守组合");
    const healthy = (await call("action", { rows: series(80, (i) => i % 10 < 7) })).data;
    expect([healthy.governance.status, healthy.action.actionable]).toEqual(["stable", true]);
  });
  it("counts one outcome per base date and ignores other policy versions in the gate", async () => {
    const rows = series(60, () => true);
    const duplicated = [...rows, { ...rows[0], Created_At: "2026-03-02T22:00:00Z" }];
    const other = rows.map((row) => ({ ...row, Policy_Version: "cloud-forecast-policy-v0" }));
    expect((await call("governance", { rows: duplicated })).data.evidence_gate.samples).toBe(60);
    expect((await call("governance", { rows: other })).data.evidence_gate).toMatchObject({ status: "insufficient", samples: 0 });
  });
  it("does not grow the ledger for repeated unqualified or unknown same-day publications", async () => {
    for (const snapshot of [null, row().Evaluation_Snapshot]) {
      const forecast = { symbol: "SPY", data_as_of: row().As_Of_Date, generated_at: row().Created_At, evaluation_snapshot: snapshot };
      const result = await call("record", { rows: [{ ...row(), Evaluation_Snapshot: null }], forecast,
        frozenAt: "2026-09-03T13:30:00Z", publicationId: "late" });
      expect(result.writes).toEqual([]);
    }
    const result = await call("record", { rows: [row()], forecast: { symbol: "SPY", data_as_of: "2026-09-03",
      generated_at: "2026-09-03T18:00:00Z" }, frozenAt: "2026-09-03T18:00:00Z", publicationId: "next-day" });
    expect(result.writes[0].value).toHaveLength(2);
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
