export type ProductEvent =
  | "search"
  | "asset_view"
  | "favorite_add"
  | "favorite_remove"
  | "alert_create"
  | "login"
  | "ai_question"
  | "forecast_view"
  | "forecast_evidence_open"
  | "recommendation_open"
  | "track_record_view"
  | "comparison_view"
  | "watchlist_view"
  | "research_review_set"
  | "research_review_complete"
  | "onboarding_preference"
  | "research_habit_cta"
  | "portfolio_view"
  | "screener_save"
  | "screener_natural_query";

export function trackEvent(event: ProductEvent): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({ event });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch {
    // Analytics is intentionally best-effort and contains no user identifiers.
  }
}

export function observeWebVitals(): () => void {
  if (typeof window === "undefined" || Math.random() >= 0.1) return () => undefined;
  const metrics: Record<string, number> = {};
  const observers: PerformanceObserver[] = [];
  let sent = false;
  const send = () => {
    if (sent || !Object.keys(metrics).length) return;
    sent = true;
    const body = JSON.stringify({ event: "web_vitals", metrics });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      else void fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    } catch { /* Performance reporting is optional. */ }
  };
  const observe = (type: string, callback: PerformanceObserverCallback) => {
    try {
      const observer = new PerformanceObserver(callback);
      observer.observe({ type, buffered: true });
      observers.push(observer);
    } catch { /* Older browsers may not support every metric. */ }
  };
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (navigation) {
    metrics.TTFB = Math.max(0, navigation.responseStart);
    metrics.LOAD = Math.max(0, navigation.loadEventEnd || navigation.domComplete);
  }
  observe("paint", (list) => {
    const fcp = list.getEntries().find((entry) => entry.name === "first-contentful-paint");
    if (fcp) metrics.FCP = fcp.startTime;
  });
  observe("largest-contentful-paint", (list) => {
    const last = list.getEntries().at(-1);
    if (last) metrics.LCP = last.startTime;
  });
  observe("layout-shift", (list) => {
    metrics.CLS = (metrics.CLS || 0) + list.getEntries().reduce((sum, entry) => {
      const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
      return sum + (!shift.hadRecentInput ? Number(shift.value || 0) : 0);
    }, 0);
  });
  const timer = window.setTimeout(send, 6000);
  window.addEventListener("pagehide", send, { once: true });
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("pagehide", send);
    observers.forEach((observer) => observer.disconnect());
    send();
  };
}
