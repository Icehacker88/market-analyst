import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrivateStorage, privateScope, privateStorageKey } from "./private-storage";
import { clearQueuedStatePatches, listQueuedStatePatches, queueStatePatch } from "./offline-store";

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });
afterEach(() => vi.unstubAllGlobals());

describe("account-owned local data", () => {
  it("isolates private values from other users, guests and unowned legacy data", () => {
    localStorage.setItem("orivane-favorites", "legacy-private");
    const alice = createPrivateStorage(privateScope("alice"));
    const bob = createPrivateStorage(privateScope("bob"));
    const guest = createPrivateStorage(privateScope(null));
    expect(alice.getItem("orivane-favorites")).toBeNull();
    alice.setItem("orivane-favorites", "alice-private");
    alice.setItem("orivane-user-state", "alice-research");
    expect(bob.getItem("orivane-favorites")).toBeNull();
    expect(guest.getItem("orivane-user-state")).toBeNull();
    expect(alice.getItem("orivane-user-state")).toBe("alice-research");
  });

  it("makes a retired account's storage handle inert", () => {
    let active = true;
    const alice = createPrivateStorage(privateScope("alice"), () => active);
    alice.setItem("chat", "before");
    active = false;
    alice.setItem("chat", "late-response");
    expect(alice.getItem("chat")).toBeNull();
    expect(createPrivateStorage(privateScope("alice")).getItem("chat")).toBe("before");
  });

  it.each(["indexedDB", "fallback"])("keeps patch ownership across accounts using %s", async (storage) => {
    if (storage === "fallback") vi.stubGlobal("indexedDB", undefined);
    await queueStatePatch("alice", { research_preferences: { goal: "learn", market: "us" } });
    await queueStatePatch("bob", { watchlists: [{ id: "b", name: "Bob", symbols: ["QQQ"] }] });
    expect(await listQueuedStatePatches("bob")).toEqual([
      expect.objectContaining({ userId: "bob", patch: { watchlists: [{ id: "b", name: "Bob", symbols: ["QQQ"] }] } }),
    ]);
    expect(await listQueuedStatePatches("alice")).toHaveLength(1);
    await clearQueuedStatePatches("bob");
    expect(await listQueuedStatePatches("bob")).toEqual([]);
    expect(await listQueuedStatePatches("alice")).toHaveLength(1);
  });

  it("ignores old queues and entries with a different owner", async () => {
    vi.stubGlobal("indexedDB", undefined);
    localStorage.setItem("orivane-state-queue-v1", JSON.stringify([{ id: "old", patch: { portfolios: [] } }]));
    localStorage.setItem(privateStorageKey(privateScope("bob"), "orivane-state-queue-v1"), JSON.stringify([
      { id: "wrong", userId: "alice", patch: { portfolios: [] } },
    ]));
    expect(await listQueuedStatePatches("bob")).toEqual([]);
    await expect(queueStatePatch("", {})).rejects.toThrow("verified user ID");
  });
});
