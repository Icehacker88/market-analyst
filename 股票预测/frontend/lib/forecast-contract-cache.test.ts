import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getForecast, getForecastScoreboard, getHomeData, getMarketSnapshots, getPerformance, getPredictionHistory, getRecommendations, getScreener, researchSnapshotPath } from "./api";
import { FORECAST_POLICY_VERSION } from "./forecast-policy";
import { CLOUD_FORECAST_POLICY_VERSION } from "../netlify/functions/_shared/forecast-eligibility";
import { writeOfflineResponse } from "./offline-store";

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

describe("forecast policy cache isolation", () => {
  const v0Forecast = { symbol: "SPY", policy_version: "cloud-forecast-policy-v0", signal: "Up", action: { actionable: true } };
  const oldPaths = [
    "/api/forecast/scoreboard?v=3&contract=frozen-close-v1",
    "/api/forecast/latest?symbol=SPY&contract=frozen-close-v1",
    "/api/home",
  ];

  it("keeps the browser constant equal to the server policy version", () => {
    expect(FORECAST_POLICY_VERSION).toBe(CLOUD_FORECAST_POLICY_VERSION);
  });

  it("never reuses localStorage or IndexedDB entries written before the policy version, fresh or stale", async () => {
    for (const [index, path] of oldPaths.entries()) {
      const stored = { value: { data: { source: "old-cache", ...v0Forecast } }, storedAt: Date.now() - (index ? 0 : 23 * 3600_000) };
      localStorage.setItem(`orivane-response-v2:${path}`, JSON.stringify(stored));
      await writeOfflineResponse(path, stored.value);
    }
    expect(await getForecastScoreboard()).toEqual({ source: "network" });
    expect(await getHomeData()).toEqual({ source: "network" });
    const forecast = await getForecast("SPY");
    expect((forecast as unknown as { source: string }).source).toBe("network");
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls).toHaveLength(3);
    expect(urls.every((url) => url.includes(`policy=${FORECAST_POLICY_VERSION}`))).toBe(true);
  });

  it("versions every forecast- or evidence-bearing request path", async () => {
    await getPredictionHistory("SPY"); await getPerformance("SPY"); await getRecommendations(); await getScreener();
    await getMarketSnapshots(["SPY"], "2025-01-01");
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(urls.every((url) => url.includes(`policy=${FORECAST_POLICY_VERSION}`))).toBe(true);
    expect(researchSnapshotPath(["SPY"])).toContain(`policy=${FORECAST_POLICY_VERSION}`);
  });

  it("shows a mismatched-version forecast as Observe and never actionable, even from the network", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ data: v0Forecast })));
    const forecast = await getForecast("SPY");
    expect([forecast.signal, forecast.action?.actionable]).toEqual(["Observe", false]);
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ data: [{ asset: { symbol: "SPY" }, forecast: v0Forecast, errors: [] }] })));
    const [snapshot] = await getMarketSnapshots(["SPY"], "2024-01-01", "full");
    expect([snapshot.forecast?.signal, snapshot.forecast?.action?.actionable]).toEqual(["Observe", false]);
  });
});
