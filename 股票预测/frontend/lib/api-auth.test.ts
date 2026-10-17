import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthSession, deleteAccountApi, getCurrentUser, getUserState, saveUserStatePatch, storeAuthSession, streamAiAnalysis } from "./api";

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe("cookie-only browser API", () => {
  it("never sends the old localStorage Bearer token and attaches the expected account guard", async () => {
    localStorage.setItem("orivane-auth-token", "forged.jwt.claims");
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ data: {} })));
    await getCurrentUser();
    await getUserState({ expectedUserId: "alice" });
    await saveUserStatePatch({ watchlists: [] }, { expectedUserId: "alice" });
    await deleteAccountApi({ expectedUserId: "alice" });
    for (const [, init] of vi.mocked(fetch).mock.calls) {
      expect(init?.credentials).toBe("include");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
    }
    for (const [, init] of vi.mocked(fetch).mock.calls.slice(1)) {
      expect(new Headers(init?.headers).get("x-orivane-user-id")).toBe("alice");
    }
  });

  it("does not send Bearer credentials on the SSE path", async () => {
    localStorage.setItem("orivane-auth-token", "forged.jwt.claims");
    vi.mocked(fetch).mockResolvedValue(new Response('event: done\ndata: {"data":{"symbol":"SPY"}}\n\n', { headers: { "content-type": "text/event-stream" } }));
    expect(await streamAiAnalysis("SPY", "en", "", [], () => {})).toMatchObject({ symbol: "SPY" });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(init?.credentials).toBe("include");
  });

  it("does not share a pending private GET between accounts", async () => {
    let release!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ data: { account_email: "bob@example.test" } })));
    const pendingAlice = getUserState({ expectedUserId: "alice" });
    const bob = await getUserState({ expectedUserId: "bob" });
    expect(bob.account_email).toBe("bob@example.test");
    expect(fetch).toHaveBeenCalledTimes(2);
    release(new Response(JSON.stringify({ data: { account_email: "alice@example.test" } })));
    expect((await pendingAlice).account_email).toBe("alice@example.test");
  });

  it("stores no shared private profile and clears obsolete login data", () => {
    localStorage.setItem("orivane-auth-user", JSON.stringify({ email: "old@example.test" }));
    localStorage.setItem("orivane-auth-token", "old-token");
    storeAuthSession({ user: { id: "alice", email: "alice@example.test" } });
    expect(localStorage.getItem("orivane-auth-token")).toBeNull();
    expect(localStorage.getItem("orivane-auth-user")).toBeNull();
    expect(localStorage.getItem("orivane-auth-user-id")).toBe("alice");
    clearAuthSession();
    expect(localStorage.getItem("orivane-auth-user-id")).toBeNull();
  });
});
