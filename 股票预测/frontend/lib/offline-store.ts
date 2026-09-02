import type { UserState } from "./types";

const DB_NAME = "orivane-offline-v1";
const DB_VERSION = 1;
const RESPONSE_STORE = "responses";
const STATE_QUEUE_STORE = "state-queue";
const FALLBACK_QUEUE_KEY = "orivane-state-queue-v1";

export type OfflineResponse<T> = { key: string; value: T; storedAt: number };
export type QueuedStatePatch = { id: string; patch: Partial<UserState>; createdAt: number };

function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
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

async function transact<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await database();
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

function fallbackQueue(): QueuedStatePatch[] {
  if (typeof localStorage === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(FALLBACK_QUEUE_KEY) || "[]") as QueuedStatePatch[]; } catch { return []; }
}

function writeFallbackQueue(queue: QueuedStatePatch[]): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(FALLBACK_QUEUE_KEY, JSON.stringify(queue.slice(-50))); } catch { /* Best effort. */ }
}

export async function queueStatePatch(patch: Partial<UserState>): Promise<QueuedStatePatch> {
  const entry: QueuedStatePatch = { id: crypto.randomUUID(), patch, createdAt: Date.now() };
  const result = await transact<IDBValidKey>(STATE_QUEUE_STORE, "readwrite", (store) => store.put(entry));
  if (result === null) writeFallbackQueue([...fallbackQueue(), entry]);
  return entry;
}

export async function listQueuedStatePatches(): Promise<QueuedStatePatch[]> {
  const indexed = await transact<QueuedStatePatch[]>(STATE_QUEUE_STORE, "readonly", (store) => store.getAll());
  const combined = [...(indexed || []), ...fallbackQueue()];
  return [...new Map(combined.map((entry) => [entry.id, entry])).values()].sort((left, right) => left.createdAt - right.createdAt);
}

export async function removeQueuedStatePatch(id: string): Promise<void> {
  await transact<undefined>(STATE_QUEUE_STORE, "readwrite", (store) => store.delete(id));
  writeFallbackQueue(fallbackQueue().filter((entry) => entry.id !== id));
}

