import type { UserState } from "./types";
import { privateScope, privateStorageKey } from "./private-storage";

const DB_NAME = "orivane-offline-v1";
const DB_VERSION = 1;
const RESPONSE_STORE = "responses";
const STATE_QUEUE_STORE = "state-queue";
const FALLBACK_QUEUE_KEY = "orivane-state-queue-v1";

export type OfflineResponse<T> = { key: string; value: T; storedAt: number };
export type QueuedStatePatch = { id: string; userId: string; patch: Partial<UserState>; createdAt: number };

function database(userId?: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(userId ? privateStorageKey(privateScope(userId), "offline") : DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RESPONSE_STORE)) db.createObjectStore(RESPONSE_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STATE_QUEUE_STORE)) db.createObjectStore(STATE_QUEUE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function transact<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>, userId?: string): Promise<T | null> {
  const db = await database(userId);
  if (!db) return null;
  return new Promise((resolve) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => { db.close(); resolve(null); };
    transaction.onabort = () => { db.close(); resolve(null); };
  });
}

export async function readOfflineResponse<T>(key: string): Promise<OfflineResponse<T> | null> {
  return transact<OfflineResponse<T>>(RESPONSE_STORE, "readonly", (store) => store.get(key));
}

export async function writeOfflineResponse<T>(key: string, value: T): Promise<void> {
  await transact<IDBValidKey>(RESPONSE_STORE, "readwrite", (store) => store.put({ key, value, storedAt: Date.now() }));
}

export async function removeOfflineResponse(key: string): Promise<void> {
  await transact<undefined>(RESPONSE_STORE, "readwrite", (store) => store.delete(key));
}

function fallbackQueue(userId: string): QueuedStatePatch[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const stored = JSON.parse(localStorage.getItem(privateStorageKey(privateScope(userId), FALLBACK_QUEUE_KEY)) || "[]");
    return Array.isArray(stored) ? stored.filter((entry: QueuedStatePatch) => entry.userId === userId) : [];
  } catch { return []; }
}

function writeFallbackQueue(userId: string, queue: QueuedStatePatch[]): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(privateStorageKey(privateScope(userId), FALLBACK_QUEUE_KEY), JSON.stringify(queue.slice(-50))); } catch { /* Best effort. */ }
}

export async function queueStatePatch(userId: string, patch: Partial<UserState>): Promise<QueuedStatePatch> {
  if (!userId) throw new Error("A verified user ID is required for an offline patch.");
  const entry: QueuedStatePatch = { id: crypto.randomUUID(), userId, patch, createdAt: Date.now() };
  const result = await transact<IDBValidKey>(STATE_QUEUE_STORE, "readwrite", (store) => store.put(entry), userId);
  if (result === null) writeFallbackQueue(userId, [...fallbackQueue(userId), entry]);
  return entry;
}

export async function listQueuedStatePatches(userId: string): Promise<QueuedStatePatch[]> {
  if (!userId) return [];
  const indexed = await transact<QueuedStatePatch[]>(STATE_QUEUE_STORE, "readonly", (store) => store.getAll(), userId);
  const combined = [...(indexed || []), ...fallbackQueue(userId)].filter((entry) => entry.userId === userId);
  return [...new Map(combined.map((entry) => [entry.id, entry])).values()].sort((left, right) => left.createdAt - right.createdAt);
}

export async function removeQueuedStatePatch(userId: string, id: string): Promise<void> {
  if (!userId) return;
  await transact<undefined>(STATE_QUEUE_STORE, "readwrite", (store) => store.delete(id), userId);
  writeFallbackQueue(userId, fallbackQueue(userId).filter((entry) => entry.id !== id));
}

export async function clearQueuedStatePatches(userId: string): Promise<void> {
  if (!userId) return;
  await transact<undefined>(STATE_QUEUE_STORE, "readwrite", (store) => store.clear(), userId);
  writeFallbackQueue(userId, []);
}
