// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import ts from "typescript";
import { currentPublicationWindow, makeEvaluationSnapshot, qualifyForecast } from "../netlify/functions/_shared/forecast-eligibility";

const root = fileURLToPath(new URL("../", import.meta.url));
let worker: Miniflare;
const postClose = "2026-10-20T20:16:00Z";
function history(day = "2026-10-20", observed = postClose) {
  return { symbol: "SPY", data_as_of: day, data_source: "yahoo", source_observed_at: observed,
    snapshot: { latest_price: 100 }, records: [{ Date: day, Price: 100, Close: 100, "Adj Close": 100 }] };
}
function forecast(generated = "2026-10-20T19:59:00Z", day = "2026-10-20") {
  return { symbol: "SPY", data_as_of: day, generated_at: generated, forecast_1d_return: .01,
    evaluation_snapshot: makeEvaluationSnapshot({ symbol: "SPY" }, history(day).records[0], "yahoo", generated, generated) };
}
function ledgerRow(value = forecast()) {
  return { Ticker: "SPY", As_Of_Date: value.data_as_of, Created_At: value.generated_at,
    Publication_ID: "original", Forecast_1D_Return: .01,
    Evaluation_Snapshot: { ...value.evaluation_snapshot, frozen_at: value.generated_at } };
}

beforeAll(async () => {
  let source = await readFile(`${root}functions/api/[[path]].ts`, "utf8");
  // Preserve real cache, freshness, generation preflight, freeze and ledger paths.
  // Substitute only external asset/provider IO, benchmark and expensive model math.
  const tree = ts.createSourceFile("worker.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits: Array<{ start: number; end: number; body: string }> = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.body) {
      const name = node.name?.text;
      let body: string | undefined;
      if (name === "resolveAsset") body = '{ return {symbol:value,name:value,asset_type:"etf",currency:"USD",exchange:"NYSE Arca",data_source:"yahoo"}; }';
      if (name === "benchmarkContextForAsset") body = '{ return undefined; }';
      if (name === "publicHistory") body = '{ testProviderCalls++; if(testInput.providerError) throw new Error("provider unavailable"); return structuredClone(testInput.freshHistory); }';
      if (name === "cloudTrendForecast") {
        const original = node.body.getText(tree);
        const marker = "  const latestPrice = Number(history.snapshot.latest_price);";
        expect(original.split(marker)).toHaveLength(2);
        body = original.slice(0, original.indexOf(marker)) + `
          if(testInput.finishAt) testNow=Date.parse(testInput.finishAt);
          const generated_at=new Date().toISOString();
          return {symbol:asset.symbol,data_as_of:history.data_as_of,generated_at,forecast_1d_return:.02,
            evaluation_snapshot:makeEvaluationSnapshot(asset,history.records.at(-1),history.data_source,history.source_observed_at,generated_at)};
        }`;
      }
      if (body) edits.push({ start: node.body.getStart(tree), end: node.body.end, body });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  expect(edits).toHaveLength(4);
  for (const edit of edits.sort((a,b) => b.start-a.start)) source = source.slice(0,edit.start)+edit.body+source.slice(edit.end);
  const marker = "return { handle, recordCacheMetric };";
  expect(source.split(marker)).toHaveLength(2);
  source = source.replace(marker, "return { handle, recordCacheMetric, readFrozenCloudForecast, generateAndFreezeCloudForecast, recordCloudForecast, rememberForecast };");
  const result = await build({ stdin: { contents: source + `
const RealDate=Date; let testNow=0, testInput, testProviderCalls=0;
globalThis.Date=class extends RealDate { constructor(...args){ if(args.length) super(...args); else super(testNow); } static now(){return testNow;} };
Math.random=()=>1;
export default { async fetch(request) {
  testInput=await request.json(); testNow=Date.parse(testInput.now); testProviderCalls=0;
  const values=new Map(), writes=[];
  const clone=(v)=>v===undefined?null:structuredClone(v);
  values.set("forecasts/v11/SPY.json",clone(testInput.cached));
  values.set("ledger/SPY.json",clone(testInput.rows || []));
  const store={get:async(key)=>values.has(key)?clone(values.get(key)):key.includes("history-v5")?{value:clone(testInput.cachedHistory),expires_at:testNow+1800000,stored_at:new Date().toISOString()}:null,
    setJSON:async(key,value)=>{values.set(key,clone(value));writes.push({key,value:clone(value)});if(testInput.acknowledgedAt && key.startsWith("forecasts/")) testNow=Date.parse(testInput.acknowledgedAt);},set:async()=>{},delete:async()=>{},list:async()=>({blobs:[]})};
  const api=createApi({env:{},getStore:()=>store,getDeployStore:()=>store,sendEmail:async()=>false});
  if(testInput.memory) api.rememberForecast("SPY",testInput.memory);
  let before, data, second, failure;
  try {
    if(testInput.operation==="retain") {
      await api.recordCloudForecast("SPY",testInput.cached,testInput.now,"new");
    } else {
      if(testInput.advanceTo){ before=await api.readFrozenCloudForecast("SPY",testInput.cached.data_as_of); testNow=Date.parse(testInput.advanceTo); }
      data=await api.readFrozenCloudForecast("SPY") || await api.generateAndFreezeCloudForecast("SPY",false);
      second=await api.readFrozenCloudForecast("SPY");
    }
  } catch(error){ failure=error.message; }
  return Response.json({before,data,second,failure,writes,providerCalls:testProviderCalls,rows:values.get("ledger/SPY.json")});
} };`, loader: "ts", resolveDir: `${root}functions/api` }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
  worker = new Miniflare({ modules: true, script: result.outputFiles[0].text, compatibilityDate: "2026-07-01", outboundService: () => { throw new Error("Network forbidden in cache recovery tests"); } });
}, 30000);
afterAll(async () => { await worker?.dispose(); });
async function run(payload: Record<string, unknown> = {}) {
  const response = await worker.dispatchFetch("https://local.test/probe", {method:"POST",body:JSON.stringify({now:postClose,cachedHistory:history(),freshHistory:history(),...payload})});
  expect(response.status).toBe(200);
  return await response.json() as any;
}

describe("closed-session cache recovery", () => {
  it("reuses intraday cache before the window, regenerates after close, and preserves the original row", async () => {
    const cached=forecast(), original=ledgerRow(cached);
    const result=await run({now:"2026-10-20T19:59:00Z",advanceTo:postClose,cached,rows:[original],
      cachedHistory:history("2026-10-20","2026-10-20T19:59:00Z")});
    expect(result.failure).toBeUndefined();
    expect(result.before.generated_at).toBe(cached.generated_at);
    expect(result.providerCalls).toBe(1);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(original);
    expect(qualifyForecast(result.rows[1],"1D",Date.parse(postClose)).status).toBe("eligible");
    expect(result.data.evaluation_snapshot.frozen_at).toBeNull();
    expect(Date.parse(result.second.generated_at)).toBe(Date.parse(postClose)); // no null-ack refresh loop
    expect(result.writes.filter((w:any)=>w.key.startsWith("publications/"))).toHaveLength(1);
  });
  it("bypasses a fresh-but-stale-date cache once and freezes the latest closed base", async () => {
    const cached=forecast("2026-10-19T21:00:00Z","2026-10-19");
    const result=await run({cached,rows:[ledgerRow(cached)],cachedHistory:history("2026-10-19","2026-10-20T20:15:00Z")});
    expect(result.failure).toBeUndefined();
    expect(result.providerCalls).toBe(1);
    expect(result.rows[0].As_Of_Date).toBe("2026-10-20");
    expect(qualifyForecast(result.rows[0],"1D",Date.parse(postClose)).status).toBe("eligible");
    expect(result.second.data_as_of).toBe("2026-10-20");
  });
  it.each(["still-stale","early-observation","missing-observation","provider-error"])("does not freeze when one forced refresh is %s", async (reason) => {
    const original=ledgerRow();
    const fresh=reason==="still-stale"?history("2026-10-19"):reason==="early-observation"?history("2026-10-20","2026-10-20T20:14:59Z"):history();
    if(reason==="missing-observation") delete (fresh as any).source_observed_at;
    const result=await run({cached:forecast(),rows:[original],cachedHistory:history("2026-10-19"),freshHistory:fresh,providerError:reason==="provider-error"});
    expect(result.failure).toBeTruthy();
    expect(result.providerCalls).toBe(1);
    expect(result.rows).toEqual([original]);
    expect(result.writes).toEqual([]);
  });
  it("keeps timely cache inputs reusable without inventing an acknowledgement or forcing provider IO", async () => {
    const cached=forecast(postClose);
    const result=await run({cached,rows:[ledgerRow(cached)],memory:forecast(),providerError:true});
    expect(result.failure).toBeUndefined();
    expect(result.data.generated_at).toBe(postClose);
    expect(result.data.evaluation_snapshot.frozen_at).toBeNull();
    expect(result.providerCalls).toBe(0);
    expect(result.writes).toEqual([]);
  });
  it("does not publish if computation crosses the next open", async () => {
    const result=await run({now:"2026-10-21T13:29:59Z",finishAt:"2026-10-21T13:30:00Z",cachedHistory:history()});
    expect(result.failure).toContain("no longer qualifies");
    expect(result.writes).toEqual([]);
  });
  it("does not append a ledger row when storage acknowledgement crosses the next open", async () => {
    const result=await run({now:"2026-10-21T13:29:59Z",acknowledgedAt:"2026-10-21T13:30:00Z",cachedHistory:history()});
    expect(result.failure).toContain("acknowledgement missed");
    expect(result.rows).toEqual([]);
    expect(result.writes.map((w:any)=>w.key.split("/")[0])).toEqual(["publications","forecasts"]);
    expect(result.writes[1].value.evaluation_snapshot.frozen_at).toBeNull();
  });
  it("retains 260 distinct dates including both rows on the oldest retained date", async () => {
    const rows=Array.from({length:260},(_,i)=>{
      const day=new Date(Date.parse("2026-10-19T00:00:00Z")-i*86400000).toISOString().slice(0,10);
      return [0,1].map((n)=>({Ticker:"SPY",As_Of_Date:day,Publication_ID:`${day}/${n}`}));
    }).flat();
    const result=await run({operation:"retain",cached:forecast(postClose),rows});
    expect(result.rows).toHaveLength(519);
    expect(new Set(result.rows.map((r:any)=>r.As_Of_Date)).size).toBe(260);
    expect(result.rows.slice(1)).toEqual(rows.slice(0,-2));
  });
});

describe("US equity publication window", () => {
  it.each([
    ["2026-10-20T20:14:59Z",null], ["2026-10-20T20:15:00Z","2026-10-20"],
    ["2026-10-21T04:24:00Z","2026-10-20"], ["2026-10-21T13:29:59Z","2026-10-20"], ["2026-10-21T13:30:00Z",null],
    ["2026-11-27T18:15:00Z","2026-11-27"], ["2026-11-29T22:00:00Z","2026-11-27"],
    ["2026-09-07T18:00:00Z","2026-09-04"], ["2026-03-09T13:30:00Z",null], ["2028-01-03T22:00:00Z",null],
  ])("%s maps to %s", (time,base) => expect(currentPublicationWindow(Date.parse(time))?.base_session ?? null).toBe(base));
});
