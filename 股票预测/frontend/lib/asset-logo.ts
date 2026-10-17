const REVISION = "20260902";
const MAX_RETRIES = 2;
const MISSING_TTL = 15 * 60_000;
// Public logo availability only; bounded to this tab and independent of account state.
const missing = new Map<string, number>();
const pending = new Map<string, Promise<Blob | null>>();

export function loadAssetLogo(symbol: string): Promise<Blob | null> {
  const expires = missing.get(symbol);
  if (expires && expires > Date.now()) return Promise.resolve(null);
  missing.delete(symbol);
  const existing = pending.get(symbol);
  if (existing) return existing;
  const request = (async () => {
    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      try {
        const response = await fetch(`/api/assets/logo?symbol=${encodeURIComponent(symbol)}&v=${REVISION}&retry=${retry}`);
        if (response.status === 404) {
          missing.set(symbol, Date.now() + MISSING_TTL);
          return null;
        }
        if (response.ok) return await response.blob();
        // Only transient server failures are retried; other HTTP failures use the fallback.
        if (response.status < 500) return null;
      } catch {
        // Network/body transfer failures remain eligible for the bounded retry budget.
      }
    }
    return null;
  })().finally(() => pending.delete(symbol));
  pending.set(symbol, request);
  return request;
}
