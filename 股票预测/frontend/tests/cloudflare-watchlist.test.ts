// @vitest-environment node

import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Test the generated Pages entry point in workerd without external network or credentials.
let worker: Miniflare;
const externalRequests: string[] = [];
const symbols = [
  "SPY", "QQQ", "AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "PLTR", "AVGO", "AMD",
  "TSM", "META", "TSLA", "NFLX", "ORCL", "CRM", "COIN", "HOOD", "MSTR", "SMCI",
  "ARM", "MU", "LLY", "BIDU", "BABA", "PDD", "JD", "NIO", "XPEV", "LI",
  "TME", "NTES", "BILI", "BEKE", "FUTU", "SOXX", "SMH", "IGV", "ARKK", "XBI",
  "GLD", "SLV", "IBIT", "QQQM", "^IXIC", "^NDX", "NQ=F", "MNQ=F", "^VIX", "0700.HK",
];

async function post(path: string, body: unknown) {
  return worker.dispatchFetch(`https://test/api${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: 'import { onRequest } from "./functions/api/[[path]].ts"; export default { fetch(request, env, ctx) { return onRequest({ request, env, waitUntil: ctx.waitUntil.bind(ctx) }); } };',
      resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts",
    },
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
  });
  worker = new Miniflare({
    modules: true, script: result.outputFiles[0].text,
    compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"],
    kvNamespaces: ["ORIVANE_API_CACHE", "ORIVANE_API_METRICS"],
    outboundService: (request) => {
      externalRequests.push(request.url);
      return Response.json({ quotes: [] });
    },
  });
}, 20_000);

beforeEach(() => { externalRequests.length = 0; });
afterAll(async () => { await worker?.dispose(); });

describe("generated Worker watchlist coverage", () => {
  it.each([5, 20, 50])("returns all %i requested watchlist assets", async (count) => {
    const requested = symbols.slice(0, count);
    const response = await post("/assets/resolve", { symbols: requested });
    expect(response.status).toBe(200);
    const result = await response.json() as { assets: Array<{ symbol: string }> };
    expect(result.assets.map((asset) => asset.symbol)).toEqual(requested);
  });

  it("deduplicates normalized symbols before resolution without losing other assets", async () => {
    const response = await post("/assets/resolve", { symbols: ["NVDA", " nvda ", "SPY", "NVDA"] });
    const result = await response.json() as { assets: Array<{ symbol: string }> };
    expect(result.assets.map((asset) => asset.symbol)).toEqual(["NVDA", "SPY"]);
    expect(externalRequests).toHaveLength(2);
  });

  it("keeps the five-asset comparison limit independent of watchlist resolution", async () => {
    const cache = await worker.getKVNamespace("ORIVANE_API_CACHE") as unknown as { put: (key: string, value: string) => Promise<void> };
    const requested = symbols.slice(0, 6);
    const year = new Date().getUTCFullYear();
    const start = `${year}-01-01`;
    for (const symbol of requested) {
      const rawKey = `history-v5/recent-${year - 4}/${symbol}/yahoo/stock`;
      const key = `v3/${encodeURIComponent(rawKey.toLowerCase()).replace(/%/g, "~")}`;
      await cache.put(key, JSON.stringify({
        expires_at: Date.now() + 60_000,
        stored_at: new Date().toISOString(),
        value: { symbol, data_source: "yahoo", data_as_of: start, records: [{ Date: start, Price: 100 }] },
      }));
    }
    const response = await post("/compare", {
      start, assets: requested.map((symbol) => ({ symbol, data_source: "yahoo", asset_type: "stock" })),
    });
    expect(response.status).toBe(200);
    const result = await response.json() as { data: { series: Array<{ symbol: string }>; errors: unknown[] } };
    expect(result.data.errors).toEqual([]);
    expect(result.data.series.map((asset) => asset.symbol)).toEqual(requested.slice(0, 5));
    expect(externalRequests).toEqual([]);
  });
});
