import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getForecast, getForecastScoreboard, getPerformance, getPredictionHistory } from "./api";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { source: "network" } }))));
});
afterEach(() => vi.unstubAllGlobals());

describe("frozen-close contract cache isolation", () => {
  it("ignores a scoreboard cached before the timing contract and fetches the versioned path", async () => {
    // A fresh browser cache entry written by the previous release under its own path.
    localStorage.setItem("orivane-response-v2:/api/forecast/scoreboard?v=2", JSON.stringify({ value: { source: "old-cache" }, storedAt: Date.now() }));
    expect(await getForecastScoreboard()).toEqual({ source: "network" });
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/api/forecast/scoreboard?v=3&contract=frozen-close-v1");
  });

  it("versions every contract-scored request so old cached responses are not reused", async () => {
    await getPredictionHistory("SPY");
    await getPerformance("SPY");
    await getForecast("SPY");
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([
      expect.stringContaining("/api/predictions/history/SPY?contract=frozen-close-v1"),
      expect.stringContaining("/api/performance/SPY?contract=frozen-close-v1"),
      expect.stringContaining("/api/forecast/latest?symbol=SPY&contract=frozen-close-v1"),
    ]);
  });
});
