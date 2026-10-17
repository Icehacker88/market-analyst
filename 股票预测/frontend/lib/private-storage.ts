export type PrivateStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function privateScope(userId: string | null): string {
  return userId === null ? "guest" : `user:${encodeURIComponent(userId)}`;
}

export function privateStorageKey(scope: string, key: string): string {
  return `orivane-private-v1:${scope}:${key}`;
}

// The owner is captured by this instance. Never infer it from cached auth metadata.
export function createPrivateStorage(scope: string | null, active: () => boolean = () => true): PrivateStorage {
  return {
    getItem(key) {
      if (scope === null || !active() || typeof localStorage === "undefined") return null;
      try { return localStorage.getItem(privateStorageKey(scope, key)); } catch { return null; }
    },
    setItem(key, value) {
      if (scope === null || !active() || typeof localStorage === "undefined") return;
      try { localStorage.setItem(privateStorageKey(scope, key), value); } catch { /* Best effort. */ }
    },
    removeItem(key) {
      if (scope === null || !active() || typeof localStorage === "undefined") return;
      try { localStorage.removeItem(privateStorageKey(scope, key)); } catch { /* Best effort. */ }
    },
  };
}

export function clearPrivateStorage(userId: string): void {
  if (typeof localStorage === "undefined") return;
  const prefix = privateStorageKey(privateScope(userId), "");
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
  keys.forEach((key) => { if (key?.startsWith(prefix)) localStorage.removeItem(key); });
}
