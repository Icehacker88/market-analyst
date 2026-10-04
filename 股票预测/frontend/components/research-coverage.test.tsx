import { render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createPrivateStorage, privateScope } from "@/lib/private-storage";
import { normalizeUserState } from "@/lib/user-state";
import type { Asset } from "@/lib/types";
import { Providers, useApp } from "./providers";

vi.mock("@/lib/api", async (original) => ({
  ...await original<typeof api>(),
  getAuthConfig: vi.fn(), getCurrentUser: vi.fn(), getUserState: vi.fn(),
  saveUserStatePatch: vi.fn(), resolveAssets: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn(), observeWebVitals: () => () => {} }));
vi.mock("./pwa-runtime", () => ({ PwaRuntime: () => null }));

function Probe() {
  const app = useApp();
  return <>
    <output data-testid="favorites">{JSON.stringify(app.favorites.map((asset) => asset.symbol))}</output>
    <output data-testid="watchlists">{JSON.stringify(app.userState.watchlists)}</output>
    <output data-testid="syncing">{String(app.cloudSyncing)}</output>
  </>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.mocked(api.getAuthConfig).mockResolvedValue({ googleEnabled: false, appleEnabled: false, signupEnabled: true });
  vi.mocked(api.getCurrentUser).mockResolvedValue({ id: "research-owner", email: "research@example.test" });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("cloud watchlist restoration into the unchanged Provider", () => {
  // These integration tests establish the Provider boundary. The actual resolve API's
  // complete 5/20/50 response contract is tested separately in cloudflare-watchlist.test.ts.
  it.each([5, 20, 50])("retains all %i unique assets across cloud watchlists", async (count) => {
    const assets: Asset[] = Array.from({ length: count }, (_, index) => ({
      symbol: `TEST${index + 1}`, name: `Test asset ${index + 1}`, asset_type: "stock", data_source: "yahoo",
    }));
    const symbols = assets.map((asset) => asset.symbol);
    const watchlists = [
      { id: "default", name: "My watchlist", symbols: symbols.slice(0, Math.ceil(count / 2)) },
      { id: "second", name: "Second watchlist", symbols: [symbols[0], ...symbols.slice(Math.ceil(count / 2))] },
    ];
    vi.mocked(api.getUserState).mockResolvedValue(normalizeUserState({ watchlists }));
    vi.mocked(api.resolveAssets).mockResolvedValue(assets);

    render(<Providers><Probe /></Providers>);

    await waitFor(() => expect(screen.getByTestId("favorites").textContent).toBe(JSON.stringify(symbols)));
    await waitFor(() => expect(screen.getByTestId("syncing")).toHaveTextContent("false"));
    expect(JSON.parse(screen.getByTestId("watchlists").textContent!)).toEqual(watchlists);
    expect(api.getUserState).toHaveBeenCalledOnce();
    expect(api.resolveAssets).toHaveBeenCalledOnce();
    expect(api.resolveAssets).toHaveBeenCalledWith(symbols);
    const stored = createPrivateStorage(privateScope("research-owner")).getItem("orivane-favorites");
    expect(JSON.parse(stored!).map((asset: Asset) => asset.symbol)).toEqual(symbols);
    expect(api.saveUserStatePatch).not.toHaveBeenCalled();
  });
});
