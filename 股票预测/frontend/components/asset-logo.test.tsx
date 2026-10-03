import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { ASSET_CATALOG } from "@/lib/asset-catalog";
import { AssetLogo, LOCAL_ASSET_LOGOS, REMOTE_LOGO_UNAVAILABLE } from "./asset-logo";

const load = vi.hoisted(() => vi.fn());
vi.mock("@/lib/asset-logo", () => ({ loadAssetLogo: load }));
beforeEach(() => {
  load.mockReset(); load.mockResolvedValue(null);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:logo"), revokeObjectURL: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

const AUDITED_REMOTE_GAPS = ["QQQ", "SMH", "ARKK", "NIO", "XPEV", "LI", "300965.SZ"];

describe("asset logo coverage", () => {
  it("keeps local fallbacks for audited blank or missing remote logos", () => {
    expect(AUDITED_REMOTE_GAPS.filter((symbol) => !LOCAL_ASSET_LOGOS[symbol])).toEqual([]);
  });

  it("gives every fund, index and market asset a dedicated logo", () => {
    const uncovered = ASSET_CATALOG
      .filter((asset) => !["stock", "etf"].includes(asset.asset_type))
      .filter((asset) => !LOCAL_ASSET_LOGOS[asset.symbol])
      .map((asset) => asset.symbol);
    expect(uncovered).toEqual([]);
  });

  it("does not request remote logos known to return 404", () => {
    expect([...REMOTE_LOGO_UNAVAILABLE]).toEqual(["301396.SZ"]);
  });

  it("keeps fallback on missing remote logo, and never retries image decoding errors", async () => {
    const asset = ASSET_CATALOG.find((item) => item.symbol === "NVDA")!;
    load.mockResolvedValueOnce(new Blob(["image"]));
    const { container, unmount } = render(<AssetLogo asset={asset} />);
    await waitFor(() => expect(container.querySelector("img")?.src).toBe("blob:logo"));
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull(); expect(load).toHaveBeenCalledTimes(1);
    unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:logo");
  });
  it("defers fetching until near viewport and ignores responses after unmount", async () => {
    let intersect!: (entries: { isIntersecting: boolean }[]) => void;
    const disconnect = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: typeof intersect) { intersect = callback; }
      observe = vi.fn(); disconnect = disconnect;
    });
    let release!: (blob: Blob) => void;
    load.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const { unmount } = render(<AssetLogo asset={ASSET_CATALOG.find((item) => item.symbol === "NVDA")!} />);
    expect(load).not.toHaveBeenCalled();
    act(() => intersect([{ isIntersecting: true }])); expect(load).toHaveBeenCalledTimes(1);
    unmount(); await act(async () => release(new Blob(["image"])));
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(disconnect).toHaveBeenCalled();
  });
});
