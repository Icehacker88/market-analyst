// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/[[path]]";

// Workers Free allows 1,000 KV writes a day across all namespaces; these guard writes that
// carried no new information.
type WorkerEnv = Parameters<typeof onRequest>[0]["env"];

class CountingKv {
  readonly values = new Map<string, string>();
  readonly writes: string[] = [];
  async get(key: string, options?: unknown): Promise<unknown> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    const type = typeof options === "string" ? options : (options as { type?: string } | undefined)?.type;
    return type === "json" ? JSON.parse(value) : value;
  }
  async put(key: string, value: string): Promise<void> { this.writes.push(key); this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.writes.push(key); this.values.delete(key); }
  async list(options?: { prefix?: string }) {
    return { keys: [...this.values.keys()].filter((key) => key.startsWith(options?.prefix || "")).map((name) => ({ name })), list_complete: true };
  }
}

const TOKEN = "local-optimizer-token";

function fixture() {
  const forecasts = new CountingKv();
  const metrics = new CountingKv();
  const env = {
    ORIVANE_USER_STATE: new CountingKv(),
    ORIVANE_API_METRICS: metrics,
    ORIVANE_API_CACHE: new CountingKv(),
    ORIVANE_AI_USAGE: new CountingKv(),
    ORIVANE_CLOUD_FORECASTS: forecasts,
    ORIVANE_ASSET_LOGOS: new CountingKv(),
    ORIVANE_OPTIMIZER_TOKEN: TOKEN,
  } as unknown as WorkerEnv;
  return { env, forecasts, metrics };
}

async function request(env: WorkerEnv, path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const background: Promise<unknown>[] = [];
  const response = await onRequest({
    request: new Request(`https://app.example.test/api${path}`, {
      method: init.method || "GET",
      headers: { origin: "https://app.example.test", "content-type": "application/json", ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    env,
    waitUntil: (promise: Promise<unknown>) => { background.push(promise); },
  } as unknown as Parameters<typeof onRequest>[0]);
  await response.text();
  await Promise.allSettled(background);
  return response;
}

const settle = (env: WorkerEnv) => request(env, "/forecast/settle", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: { symbols: ["SPY"] } });

beforeEach(() => {
  vi.spyOn(Math, "random").mockReturnValue(1);
  vi.stubGlobal("caches", undefined);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected network access in KV write budget test."); }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("KV write budget", () => {
  it("rewrites model governance only when the evaluation changed, not on every settlement", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-30T00:15:00Z"));
    const { env, forecasts } = fixture();
    expect((await settle(env)).status).toBe(200);
    expect(forecasts.writes).toEqual(["governance/v1/SPY.json"]);
    const stored = forecasts.values.get("governance/v1/SPY.json");

    vi.setSystemTime(new Date("2026-10-30T00:45:00Z"));
    expect((await settle(env)).status).toBe(200);
    expect(forecasts.writes).toEqual(["governance/v1/SPY.json"]);
    expect(forecasts.values.get("governance/v1/SPY.json")).toBe(stored);

    // A different stored evaluation (here: older wording) is replaced.
    forecasts.values.set("governance/v1/SPY.json", JSON.stringify({ ...JSON.parse(stored!), reason_en: "Older wording." }));
    expect((await settle(env)).status).toBe(200);
    expect(forecasts.writes).toEqual(["governance/v1/SPY.json", "governance/v1/SPY.json"]);
  });

  it("does not record the favorite optimizer's runs and prewarm requests in request metrics", async () => {
    const { env, metrics } = fixture();
    const requests = () => Object.keys((JSON.parse([...metrics.values.values()][0] || "{}") as { requests?: object }).requests || {});
    const run = (headers: Record<string, string>) => request(env, "/forecast/run", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, ...headers }, body: { symbol: "SPY", optimize: false } });
    expect((await run({ "x-orivane-job": "favorite-optimizer" })).status).toBe(502);
    expect((await request(env, "/forecast/latest?symbol=ZZZZ", { headers: { "x-orivane-prewarm": "1" } })).status).toBe(502);
    expect(requests()).toEqual([]);
    // The same failures from anyone else are still recorded (every 5xx is).
    expect((await run({})).status).toBe(502);
    expect((await request(env, "/forecast/latest?symbol=ZZZZ")).status).toBe(502);
    expect(requests().sort()).toEqual(["GET /forecast/latest", "POST /forecast/run"]);
  });
});
