// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const put = vi.fn().mockResolvedValue(undefined);
  const caches = { open: vi.fn().mockResolvedValue({ put }), match: vi.fn().mockResolvedValue(undefined) };
  const fetch = vi.fn();
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    URL, caches, fetch,
    self: { location: { origin: "https://preview.example" }, addEventListener: (name: string, fn: (event: unknown) => void) => { handlers[name] = fn; } },
  });
  function request(path = "/_next/static/app.js", mode = "cors") {
    const waits: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    handlers.fetch({ request: { url: `https://preview.example${path}`, method: "GET", mode },
      respondWith: (value: Promise<Response>) => { response = value; }, waitUntil: (value: Promise<unknown>) => { waits.push(value); } });
    return { response, waits };
  }
  return { caches, fetch, put, request };
}

describe("service worker response ownership and existing cache policy", () => {
  it.each(["cors", "navigate"])("clones %s network success before delayed cache open and client body consumption", async (mode) => {
    const w = worker();
    let release!: (cache: { put: typeof w.put }) => void;
    w.caches.open.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    w.fetch.mockResolvedValue(new Response("payload"));
    const event = w.request(mode === "navigate" ? "/" : undefined, mode);
    const response = await event.response!;
    expect(await response.text()).toBe("payload");
    release({ put: w.put });
    await Promise.all(event.waits);
    expect(w.put).toHaveBeenCalledTimes(1);
    expect(await w.put.mock.calls[0][1].text()).toBe("payload");
  });
  it("serves a static cache hit without fetching or writing", async () => {
    const w = worker(); w.caches.match.mockResolvedValue(new Response("cached"));
    expect(await (await w.request().response!).text()).toBe("cached");
    expect(w.fetch).not.toHaveBeenCalled(); expect(w.put).not.toHaveBeenCalled();
  });
  it.each([404, 503])("returns static HTTP %s unchanged without caching", async (status) => {
    const w = worker(); w.fetch.mockResolvedValue(new Response("failure", { status }));
    const event = w.request(); const response = await event.response!;
    expect(response.status).toBe(status); expect(await response.text()).toBe("failure");
    expect(event.waits).toHaveLength(0); expect(w.caches.open).not.toHaveBeenCalled();
  });
  it("propagates static network failure without a cache entry", async () => {
    const w = worker(); w.fetch.mockRejectedValue(new Error("offline"));
    await expect(w.request().response).rejects.toThrow("offline"); expect(w.put).not.toHaveBeenCalled();
  });
  it.each([true, false])("navigation network failure uses page cache then offline shell (page cached=%s)", async (cached) => {
    const w = worker(); w.fetch.mockRejectedValue(new Error("offline"));
    w.caches.match.mockResolvedValueOnce(cached ? new Response("page") : undefined).mockResolvedValueOnce(new Response("offline"));
    expect(await (await w.request("/research/", "navigate").response!).text()).toBe(cached ? "page" : "offline");
    expect(w.caches.match).toHaveBeenCalledTimes(cached ? 1 : 2);
  });
  it("preserves navigation non-200 network-first caching semantics", async () => {
    const w = worker(); w.fetch.mockResolvedValue(new Response("missing", { status: 404 }));
    const event = w.request("/missing/", "navigate");
    expect((await event.response!).status).toBe(404); await Promise.all(event.waits);
    expect(w.put.mock.calls[0][1].status).toBe(404);
  });
  it("does not intercept API requests", () => {
    const w = worker(); expect(w.request("/api/home").response).toBeUndefined(); expect(w.fetch).not.toHaveBeenCalled();
  });
});
