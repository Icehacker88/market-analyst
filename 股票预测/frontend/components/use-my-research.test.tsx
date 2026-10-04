import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Forecast, MarketSnapshot } from "@/lib/types";
import { useMyResearch } from "./use-my-research";

const cache = vi.hoisted(() => ({ stored: null as { value: { data: MarketSnapshot[] }; storedAt: number } | null }));
vi.mock("@/lib/offline-store", () => ({
  readOfflineResponse: vi.fn(async () => cache.stored),
  writeOfflineResponse: vi.fn(async () => {}),
  removeOfflineResponse: vi.fn(async () => {}),
}));

function snapshot(symbol: string, price: number): MarketSnapshot {
  return {
    asset: { symbol, name: symbol, asset_type: "stock", data_source: "yahoo" },
    history: { symbol, data_source: "yahoo", data_as_of: "2026-10-04", snapshot: { latest_price: price }, records: [] },
    forecast: { symbol, signal: "Up", base_price: price, data_as_of: "2026-10-04" } as Forecast,
    errors: [],
  };
}

afterEach(() => { vi.unstubAllGlobals(); cache.stored = null; });

describe("mounted My Research workspace data", () => {
  it("updates stale values in the same hook when the background request succeeds", async () => {
    cache.stored = { value: { data: [snapshot("STALE_HOOK", 90)] }, storedAt: Date.now() - 16 * 60_000 };
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    vi.stubGlobal("fetch", vi.fn(() => pending));
    const { result } = renderHook(() => useMyResearch(["STALE_HOOK"]));
    await waitFor(() => expect(result.current.entries.STALE_HOOK.status).toBe("stale"));
    expect(result.current.entries.STALE_HOOK.history?.snapshot.latest_price).toBe(90);
    await act(async () => finish(new Response(JSON.stringify({ data: [snapshot("STALE_HOOK", 120)] }), { status: 200 })));
    await waitFor(() => expect(result.current.entries.STALE_HOOK.status).toBe("fresh"));
    expect(result.current.entries.STALE_HOOK.history?.snapshot.latest_price).toBe(120);
    expect(result.current.loading).toBe(false);
  });

  it("a stable symbol list does not refetch on parent render, but refresh updates current values", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [snapshot("REFRESH_HOOK", fetchMock.mock.calls.length === 1 ? 100 : 110)] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ symbols }) => useMyResearch(symbols), { initialProps: { symbols: ["REFRESH_HOOK"] } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries.REFRESH_HOOK.history?.snapshot.latest_price).toBe(100);
    rerender({ symbols: ["REFRESH_HOOK"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.entries.REFRESH_HOOK.history?.snapshot.latest_price).toBe(110));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    rerender({ symbols: [] });
    expect(result.current.entries).toEqual({});
    expect(result.current.loading).toBe(false);
  });
});
