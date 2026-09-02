type BrowserConnection = {
  effectiveType?: "slow-2g" | "2g" | "3g" | "4g";
  saveData?: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

export function browserConnection(): BrowserConnection | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { connection?: BrowserConnection; mozConnection?: BrowserConnection; webkitConnection?: BrowserConnection }).connection
    || (navigator as Navigator & { mozConnection?: BrowserConnection }).mozConnection
    || (navigator as Navigator & { webkitConnection?: BrowserConnection }).webkitConnection
    || null;
}

export function isConstrainedNetwork(): boolean {
  const connection = browserConnection();
  return Boolean(connection?.saveData || connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g");
}

export function scheduleBackgroundTask(task: () => void, options: { fastDelay?: number; constrainedDelay?: number; timeout?: number } = {}): () => void {
  if (typeof window === "undefined") return () => undefined;
  const delay = isConstrainedNetwork() ? options.constrainedDelay ?? 2200 : options.fastDelay ?? 350;
  let cancelled = false;
  let idleId: number | null = null;
  const timer = window.setTimeout(() => {
    const run = () => { if (!cancelled) task(); };
    if ("requestIdleCallback" in window) {
      idleId = (window as Window & { requestIdleCallback: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback(run, { timeout: options.timeout ?? 1600 });
    } else run();
  }, delay);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    if (idleId !== null && "cancelIdleCallback" in window) {
      (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(idleId);
    }
  };
}

