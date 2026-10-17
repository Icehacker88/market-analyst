import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { listQueuedStatePatches, queueStatePatch } from "@/lib/offline-store";
import { createPrivateStorage, privateScope } from "@/lib/private-storage";
import { normalizeUserState } from "@/lib/user-state";
import type { Asset, AuthUser, UserState } from "@/lib/types";
import { useAuth } from "./auth-provider";
import { Providers, useApp } from "./providers";

vi.mock("@/lib/api", async (original) => ({
  ...await original<typeof api>(),
  getAuthConfig: vi.fn(), getCurrentUser: vi.fn(), getUserState: vi.fn(),
  saveUserStatePatch: vi.fn(), loginWithEmailApi: vi.fn(), resolveAssets: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn(), observeWebVitals: () => () => {} }));
vi.mock("./pwa-runtime", () => ({ PwaRuntime: () => null }));

const alice: AuthUser = { id: "alice", email: "alice@example.test" };
const bob: AuthUser = { id: "bob", email: "bob@example.test" };
const spy: Asset = { symbol: "SPY", name: "SPY", asset_type: "etf", data_source: "yahoo" };
const qqq: Asset = { ...spy, symbol: "QQQ", name: "QQQ" };
const ownedState = (owner: string, symbol: string) => normalizeUserState({
  watchlists: [{ id: "default", name: `${owner} private`, symbols: [symbol] }],
});
let cookieUser: AuthUser | null;
let states: Record<string, UserState>;

function Probe() {
  const auth = useAuth();
  const app = useApp();
  return <div>
    <span data-testid="identity">{auth.loading ? "pending" : auth.user?.id || "guest"}</span>
    <span data-testid="state">{JSON.stringify(app.userState)}</span>
    <span data-testid="favorites">{app.favorites.map((asset) => asset.symbol).join(",")}</span>
    <span data-testid="syncing">{String(app.cloudSyncing)}</span>
    <button onClick={() => void auth.signOut()}>logout</button>
    <button onClick={() => void auth.loginWithEmail(bob.email, "test-password")}>login bob</button>
    <button onClick={() => app.updateUserState((current) => ({ ...current, research_preferences: { goal: "learn", market: "us" } }))}>edit research</button>
  </div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieUser = alice;
  states = { alice: ownedState("alice", "SPY"), bob: ownedState("bob", "QQQ") };
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    if (String(input) !== "/api/auth/logout") throw new Error(`Unexpected network access: ${String(input)}`);
    cookieUser = null;
    return new Response("{}");
  }));
  vi.mocked(api.getAuthConfig).mockResolvedValue({ googleEnabled: false, appleEnabled: false, signupEnabled: true });
  vi.mocked(api.getCurrentUser).mockImplementation(async () => cookieUser);
  vi.mocked(api.loginWithEmailApi).mockImplementation(async () => { cookieUser = bob; return { user: bob }; });
  vi.mocked(api.resolveAssets).mockImplementation(async (symbols) => symbols.map((symbol) => symbol === "SPY" ? spy : qqq));
  vi.mocked(api.getUserState).mockImplementation(async (options) => {
    if (!cookieUser || cookieUser.id !== options?.expectedUserId) throw new Error("account changed");
    return states[cookieUser.id];
  });
  vi.mocked(api.saveUserStatePatch).mockImplementation(async (patch, options) => {
    if (!cookieUser || cookieUser.id !== options?.expectedUserId) throw new Error("account changed");
    return states[cookieUser.id] = normalizeUserState({ ...states[cookieUser.id], ...patch });
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function ready(user: string) {
  await waitFor(() => expect(screen.getByTestId("identity")).toHaveTextContent(user));
  if (user !== "guest") await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent(`${user} `));
  await waitFor(() => expect(screen.getByTestId("syncing")).toHaveTextContent("false"));
}

describe("browser account boundaries", () => {
  it("validates the cookie before displaying identity or loading private data, without trusting stored auth", async () => {
    let verify!: (user: AuthUser | null) => void;
    localStorage.setItem("orivane-auth-user", JSON.stringify({ id: "mallory", email: "mallory@example.test" }));
    localStorage.setItem("orivane-user-state", JSON.stringify(ownedState("legacy", "SPY")));
    vi.mocked(api.getCurrentUser).mockImplementationOnce(() => new Promise((resolve) => { verify = resolve; }));
    render(<Providers><Probe /></Providers>);
    expect(screen.getByTestId("identity")).toHaveTextContent("pending");
    expect(screen.getByTestId("state")).not.toHaveTextContent("legacy");
    expect(api.getUserState).not.toHaveBeenCalled();
    await act(async () => { verify(alice); });
    await ready("alice");
    expect(screen.getByTestId("state")).toHaveTextContent("alice private");
    expect(api.getCurrentUser).toHaveBeenCalledOnce();
  });

  it("does not display or upload Alice's data and queue after logout followed by Bob login", async () => {
    render(<Providers><Probe /></Providers>);
    await ready("alice");
    expect(screen.getByTestId("favorites")).toHaveTextContent("SPY");
    await queueStatePatch("alice", { watchlists: [{ id: "default", name: "alice offline private", symbols: ["SPY"] }] });
    await queueStatePatch("bob", { watchlists: [{ id: "default", name: "bob offline private", symbols: ["QQQ"] }] });
    fireEvent.click(screen.getByText("edit research"));
    fireEvent.click(screen.getByText("logout"));
    await ready("guest");
    expect(screen.getByTestId("state")).not.toHaveTextContent("alice");
    expect(screen.getByTestId("favorites")).not.toHaveTextContent("SPY");
    vi.mocked(api.saveUserStatePatch).mockClear();
    fireEvent.click(screen.getByText("login bob"));
    await ready("bob");
    expect(screen.getByTestId("state")).toHaveTextContent("bob offline private");
    expect(screen.getByTestId("state")).not.toHaveTextContent("alice");
    expect(screen.getByTestId("state")).not.toHaveTextContent('"goal":"learn"');
    expect(screen.getByTestId("favorites")).toHaveTextContent("QQQ");
    expect(api.saveUserStatePatch).toHaveBeenCalled();
    for (const [patch, options] of vi.mocked(api.saveUserStatePatch).mock.calls) {
      expect(options?.expectedUserId).toBe("bob");
      expect(JSON.stringify(patch)).not.toContain("alice");
      expect(JSON.stringify(patch)).not.toContain("SPY");
    }
    expect(await listQueuedStatePatches("alice")).not.toHaveLength(0);
    expect(await listQueuedStatePatches("bob")).toHaveLength(0);
  });

  it("aborts and ignores a late Alice load after Bob is signed in", async () => {
    let release!: (state: UserState) => void;
    vi.mocked(api.getUserState).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    render(<Providers><Probe /></Providers>);
    await waitFor(() => expect(api.getUserState).toHaveBeenCalledOnce());
    const aliceSignal = vi.mocked(api.getUserState).mock.calls[0][0]?.signal;
    fireEvent.click(screen.getByText("logout"));
    await ready("guest");
    expect(aliceSignal?.aborted).toBe(true);
    fireEvent.click(screen.getByText("login bob"));
    await ready("bob");
    await act(async () => { release(states.alice); });
    expect(screen.getByTestId("state")).toHaveTextContent("bob private");
    expect(screen.getByTestId("state")).not.toHaveTextContent("alice");
    expect(createPrivateStorage(privateScope("bob")).getItem("orivane-user-state")).not.toContain("alice");
  });

  it("does not apply a late save response to the next account", async () => {
    render(<Providers><Probe /></Providers>);
    await ready("alice");
    let release!: (state: UserState) => void;
    vi.mocked(api.saveUserStatePatch).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    fireEvent.click(screen.getByText("edit research"));
    await waitFor(() => expect(api.saveUserStatePatch).toHaveBeenCalledOnce());
    const aliceSignal = vi.mocked(api.saveUserStatePatch).mock.calls[0][1]?.signal;
    fireEvent.click(screen.getByText("logout"));
    await ready("guest");
    expect(aliceSignal?.aborted).toBe(true);
    fireEvent.click(screen.getByText("login bob"));
    await ready("bob");
    await act(async () => { release(normalizeUserState({ ...states.alice, research_preferences: { goal: "learn", market: "us" } })); });
    expect(screen.getByTestId("state")).toHaveTextContent("bob private");
    expect(screen.getByTestId("state")).not.toHaveTextContent('"goal":"learn"');
  });

  it("retains Alice's offline edits made before the first cloud read succeeds without uploading them as Bob", async () => {
    createPrivateStorage(privateScope("alice")).setItem("orivane-user-state", JSON.stringify(states.alice));
    vi.mocked(api.getUserState).mockRejectedValueOnce(new Error("offline"));
    render(<Providers><Probe /></Providers>);
    await ready("alice");
    fireEvent.click(screen.getByText("edit research"));
    await waitFor(async () => expect(await listQueuedStatePatches("alice")).toEqual([
      expect.objectContaining({ userId: "alice", patch: { research_preferences: { goal: "learn", market: "us" } } }),
    ]));
    fireEvent.click(screen.getByText("logout"));
    await ready("guest");
    fireEvent.click(screen.getByText("login bob"));
    await ready("bob");
    expect(screen.getByTestId("state")).not.toHaveTextContent('"goal":"learn"');
    expect(await listQueuedStatePatches("alice")).toHaveLength(1);
    expect(api.saveUserStatePatch).not.toHaveBeenCalled();
  });
});
