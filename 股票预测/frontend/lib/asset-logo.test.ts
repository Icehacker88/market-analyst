import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
let loadAssetLogo: typeof import("./asset-logo").loadAssetLogo;
beforeEach(async () => { vi.resetModules(); vi.stubGlobal("fetch", vi.fn()); ({ loadAssetLogo } = await import("./asset-logo")); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("status-aware logo loading", () => {
  it("deduplicates 404, stops retries, and remembers absence for 15 minutes", async () => {
    vi.useFakeTimers(); vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));
    expect(await Promise.all([loadAssetLogo("AAOG"), loadAssetLogo("AAOG")])).toEqual([null, null]);
    expect(await loadAssetLogo("AAOG")).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("retry=0"));
    vi.advanceTimersByTime(15 * 60_000 + 1); await loadAssetLogo("AAOG"); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["network", "server"])("retries %s failure then uses success body without an extra image HTTP request", async (kind) => {
    const mock = vi.mocked(fetch);
    if (kind === "network") mock.mockRejectedValueOnce(new TypeError("offline"));
    else mock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    mock.mockResolvedValueOnce(new Response("image", { headers: { "Content-Type": "image/png" } }));
    const blob = await loadAssetLogo("NVDA"); expect(blob?.size).toBe(5); expect(blob?.type).toBe("image/png");
    expect(mock).toHaveBeenCalledTimes(2); expect(mock.mock.calls[1][0]).toContain("retry=1");
  });
  it("caps transient retries and does not negatively cache server failures", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    expect(await loadAssetLogo("NVDA")).toBeNull(); expect(fetch).toHaveBeenCalledTimes(3);
    await loadAssetLogo("NVDA"); expect(fetch).toHaveBeenCalledTimes(6);
  });
  it("stops on a 404 even after a transient failure", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(new Response(null, { status: 404 }));
    await loadAssetLogo("AAOG"); await loadAssetLogo("AAOG"); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not retry other client errors", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 403 }));
    expect(await loadAssetLogo("NVDA")).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
