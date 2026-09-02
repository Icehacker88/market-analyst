import type { AiAnalysis, Asset, AuthSession, AuthUser, CompanyResearch, CompareSeries, Forecast, ForecastScoreboard, Gainer, History, HomeData, MarketOverview, MarketSnapshot, MetricsSummary, Performance, PeriodReturns, PredictionHistory, Recommendations, ScreenerRow, UserState } from "./types";
import { readOfflineResponse, removeOfflineResponse, writeOfflineResponse } from "./offline-store";

const SEARCH_CACHE_MS = 30 * 60 * 1000;
const RESPONSE_CACHE_PREFIX = "orivane-response-v2:";
const INFLIGHT_GETS = new Map<string, Promise<unknown>>();

type ResponseCachePolicy = { freshMs: number; staleMs: number };
type StoredResponse<T> = { value: T; storedAt: number };

function responseCachePolicy(path: string): ResponseCachePolicy | null {
  const basePath = path.split("?")[0];
  if (basePath === "/api/home") return { freshMs: 15 * 60_000, staleMs: 24 * 3600_000 };
  if (basePath === "/api/forecast/scoreboard") return { freshMs: 60 * 60_000, staleMs: 24 * 3600_000 };
  if (basePath === "/api/recommendations" || basePath === "/api/screener") return { freshMs: 30 * 60_000, staleMs: 24 * 3600_000 };
  if (basePath.startsWith("/api/forecast/latest")) return { freshMs: 30 * 60_000, staleMs: 24 * 3600_000 };
  if (basePath.startsWith("/api/market/returns")) return { freshMs: 60 * 60_000, staleMs: 24 * 3600_000 };
  if (basePath.startsWith("/api/market/history")) return { freshMs: 15 * 60_000, staleMs: 24 * 3600_000 };
  if (basePath.startsWith("/api/market/snapshot")) return { freshMs: 15 * 60_000, staleMs: 24 * 3600_000 };
  if (basePath.startsWith("/api/predictions/") || basePath.startsWith("/api/performance/")) return { freshMs: 60 * 60_000, staleMs: 24 * 3600_000 };
  if (basePath === "/api/health") return { freshMs: 2 * 60_000, staleMs: 6 * 3600_000 };
  if (basePath === "/api/auth/config") return { freshMs: 24 * 3600_000, staleMs: 7 * 24 * 3600_000 };
  return null;
}

function requestTimeout(path: string): number {
  const basePath = path.split("?")[0];
  if (basePath.startsWith("/api/ai/")) return 30_000;
  if (basePath.startsWith("/api/forecast/run")) return 30_000;
  if (
    basePath === "/api/home"
    || basePath === "/api/recommendations"
    || basePath === "/api/screener"
    || basePath === "/api/forecast/scoreboard"
    || basePath.startsWith("/api/forecast/latest")
  ) return 30_000;
  if (basePath.startsWith("/api/market/history") || basePath.startsWith("/api/market/returns") || basePath === "/api/compare") return 25_000;
  return 12_000;
}

function apiBase(): string {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) return process.env.NEXT_PUBLIC_API_BASE_URL;
  if (typeof window === "undefined") return "";
  return ["127.0.0.1", "localhost"].includes(window.location.hostname) && window.location.port === "3000"
    ? "http://127.0.0.1:8000"
    : "";
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function getHealth(): Promise<{ status: "checking" | "ok" | "degraded"; yahoo_finance?: string; eastmoney_data?: string; last_updated?: string | null; probe_pending?: boolean; market_data_provider?: string; paid_provider_ready?: boolean }> {
  return request<{ status: "checking" | "ok" | "degraded"; yahoo_finance?: string; eastmoney_data?: string; last_updated?: string | null; probe_pending?: boolean; market_data_provider?: string; paid_provider_ready?: boolean }>("/api/health");
}

export async function getMetrics(): Promise<MetricsSummary> {
  return (await request<{ data: MetricsSummary }>("/api/admin/metrics")).data;
}

function readResponseCache<T>(path: string, policy: ResponseCachePolicy): { fresh: T | null; stale: T | null } {
  if (typeof window === "undefined") return { fresh: null, stale: null };
  try {
    const stored = JSON.parse(localStorage.getItem(`${RESPONSE_CACHE_PREFIX}${path}`) || "null") as StoredResponse<T> | null;
    if (!stored) return { fresh: null, stale: null };
    const age = Date.now() - stored.storedAt;
    if (age <= policy.freshMs) return { fresh: stored.value, stale: stored.value };
    if (age <= policy.staleMs) return { fresh: null, stale: stored.value };
    localStorage.removeItem(`${RESPONSE_CACHE_PREFIX}${path}`);
  } catch {
    localStorage.removeItem(`${RESPONSE_CACHE_PREFIX}${path}`);
  }
  return { fresh: null, stale: null };
}

function evaluateStoredResponse<T>(stored: StoredResponse<T> | null, policy: ResponseCachePolicy): { fresh: T | null; stale: T | null; expired: boolean } {
  if (!stored) return { fresh: null, stale: null, expired: false };
  const age = Date.now() - stored.storedAt;
  if (age <= policy.freshMs) return { fresh: stored.value, stale: stored.value, expired: false };
  if (age <= policy.staleMs) return { fresh: null, stale: stored.value, expired: false };
  return { fresh: null, stale: null, expired: true };
}

function useLocalStorageResponseCache(path: string): boolean {
  const basePath = path.split("?")[0];
  return !basePath.startsWith("/api/market/history") && !basePath.startsWith("/api/market/snapshot");
}

function writeResponseCache<T>(path: string, value: T): void {
  if (typeof window === "undefined") return;
  if (useLocalStorageResponseCache(path)) {
    try { localStorage.setItem(`${RESPONSE_CACHE_PREFIX}${path}`, JSON.stringify({ value, storedAt: Date.now() })); } catch { /* IndexedDB remains available. */ }
  }
  void writeOfflineResponse(path, value);
}

function combinedSignal(external: AbortSignal | null | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let timeoutTriggered = false;
  const timer = window.setTimeout(() => {
    timeoutTriggered = true;
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, timeoutMs);
  const abort = () => controller.abort(external?.reason);
  external?.addEventListener("abort", abort, { once: true });
  if (external?.aborted) abort();
  return {
    signal: controller.signal,
    timedOut: () => timeoutTriggered,
    cleanup: () => {
      window.clearTimeout(timer);
      external?.removeEventListener("abort", abort);
    },
  };
}

async function executeRequest<T>(path: string, init: RequestInit | undefined, stale: T | null, cacheable: boolean): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init?.headers as Record<string, string> | undefined || {}) };
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("orivane-auth-token");
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const timeout = typeof window !== "undefined" ? combinedSignal(init?.signal, requestTimeout(path)) : null;
  try {
    const response = await fetch(`${apiBase()}${path}`, {
      ...init,
      signal: timeout?.signal || init?.signal,
      credentials: "include",
      headers,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(payload?.error?.message || payload?.detail || "Request failed", response.status);
    if (cacheable) writeResponseCache(path, payload);
    return payload;
  } catch (cause) {
    if (stale !== null) return stale;
    if (timeout?.timedOut()) throw new ApiError("Request timed out", 408);
    throw cause;
  } finally {
    timeout?.cleanup();
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isGet = !init?.method || init.method.toUpperCase() === "GET";
  const policy = isGet && init?.cache !== "no-store" ? responseCachePolicy(path) : null;
  let cached = policy ? readResponseCache<T>(path, policy) : { fresh: null, stale: null };
  if (policy && cached.fresh === null && cached.stale === null && typeof window !== "undefined") {
    const offline = await readOfflineResponse<T>(path);
    const evaluated = evaluateStoredResponse(offline ? { value: offline.value, storedAt: offline.storedAt } : null, policy);
    cached = { fresh: evaluated.fresh, stale: evaluated.stale };
    if (evaluated.expired) void removeOfflineResponse(path);
  }
  if (cached.fresh !== null) return cached.fresh;
  const key = isGet || path === "/api/compare" ? `${init?.method || "GET"}:${path}:${String(init?.body || "")}` : "";
  if (cached.stale !== null) {
    if (!key || !INFLIGHT_GETS.has(key)) {
      const refresh = executeRequest<T>(path, init, null, Boolean(policy));
      if (key) INFLIGHT_GETS.set(key, refresh);
      void refresh.catch(() => undefined).finally(() => {
        if (key && INFLIGHT_GETS.get(key) === refresh) INFLIGHT_GETS.delete(key);
      });
    }
    return cached.stale;
  }
  if (key && INFLIGHT_GETS.has(key)) return INFLIGHT_GETS.get(key) as Promise<T>;
  const pending = executeRequest(path, init, cached.stale, Boolean(policy));
  if (key) INFLIGHT_GETS.set(key, pending);
  try {
    return await pending;
  } finally {
    if (key && INFLIGHT_GETS.get(key) === pending) INFLIGHT_GETS.delete(key);
  }
}

export function storeAuthSession(session: AuthSession): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("orivane-auth-token");
  localStorage.setItem("orivane-auth-user", JSON.stringify(session.user));
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("orivane-auth-token");
  localStorage.removeItem("orivane-auth-user");
}

export function readStoredAuthUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const user = JSON.parse(localStorage.getItem("orivane-auth-user") || "null") as AuthUser | null;
    return user?.email ? user : null;
  } catch {
    clearAuthSession();
    return null;
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  return (await request<{ data: AuthUser | null }>("/api/auth/me")).data;
}

export async function getAuthConfig(): Promise<{ googleEnabled: boolean; appleEnabled: boolean; signupEnabled: boolean }> {
  return (await request<{ data: { googleEnabled: boolean; appleEnabled: boolean; signupEnabled: boolean } }>("/api/auth/config")).data;
}

export async function loginWithEmailApi(email: string, password: string): Promise<AuthSession> {
  return (await request<{ data: AuthSession }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })).data;
}

export async function signupWithEmailApi(email: string, password: string, name: string): Promise<AuthSession> {
  return (await request<{ data: AuthSession }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
  })).data;
}

function readBrowserCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const cached = JSON.parse(localStorage.getItem(key) || "null") as { value: T; expiresAt: number } | null;
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) localStorage.removeItem(key);
  } catch {
    localStorage.removeItem(key);
  }
  return null;
}

function writeBrowserCache<T>(key: string, value: T, ttlMs: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify({ value, expiresAt: Date.now() + ttlMs }));
  } catch {
    // Local cache is optional.
  }
}

export async function searchAssets(query: string, signal?: AbortSignal): Promise<Asset[]> {
  const normalized = query.trim().toLowerCase();
  const cacheKey = `orivane-search-v2:${normalized}`;
  const cached = readBrowserCache<Asset[]>(cacheKey);
  if (cached) return cached;
  const results = (await request<{ results: Asset[] }>(`/api/assets/search?q=${encodeURIComponent(query)}`, { signal })).results;
  writeBrowserCache(cacheKey, results, SEARCH_CACHE_MS);
  return results;
}

export async function resolveAssets(symbols: string[]): Promise<Asset[]> {
  return (await request<{ assets: Asset[] }>("/api/assets/resolve", {
    method: "POST",
    body: JSON.stringify({ symbols }),
  })).assets;
}

export async function getGainers(): Promise<Gainer[]> {
  return (await request<{ data: Gainer[] }>("/api/market/gainers")).data;
}

export async function getMarketOverview(): Promise<MarketOverview> {
  return (await request<{ data: MarketOverview }>("/api/market/overview")).data;
}

export async function getHomeData(): Promise<HomeData> {
  return (await request<{ data: HomeData }>("/api/home")).data;
}

export async function getForecastScoreboard(): Promise<ForecastScoreboard> {
  return (await request<{ data: ForecastScoreboard }>("/api/forecast/scoreboard?v=2")).data;
}

export async function getScreener(): Promise<ScreenerRow[]> {
  return (await request<{ data: ScreenerRow[] }>("/api/screener?v=5")).data;
}

export async function getRecommendations(): Promise<Recommendations> {
  return (await request<{ data: Recommendations }>("/api/recommendations?v=6")).data;
}

export async function getAiAnalysis(symbol: string, language: "zh" | "en", question?: string, conversation?: { role: "user" | "assistant"; content: string }[], signal?: AbortSignal): Promise<AiAnalysis> {
  return (await request<{ data: AiAnalysis }>("/api/ai/analysis", {
    method: "POST",
    body: JSON.stringify({ symbol, language, question, conversation }),
    signal,
  })).data;
}

export async function streamAiAnalysis(
  symbol: string,
  language: "zh" | "en",
  question: string | undefined,
  conversation: { role: "user" | "assistant"; content: string }[] | undefined,
  onToken: (token: string) => void,
  signal?: AbortSignal,
): Promise<AiAnalysis> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "text/event-stream" };
  const token = typeof window !== "undefined" ? localStorage.getItem("orivane-auth-token") : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  const timeout = typeof window !== "undefined" ? combinedSignal(signal, 45_000) : null;
  try {
    const response = await fetch(`${apiBase()}/api/ai/analysis/stream`, {
      method: "POST",
      body: JSON.stringify({ symbol, language, question, conversation }),
      credentials: "include",
      headers,
      signal: timeout?.signal || signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new ApiError(payload?.error?.message || "AI request failed", response.status);
    }
    if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
      const payload = await response.json() as { data: AiAnalysis };
      return payload.data;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: AiAnalysis | null = null;
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const event = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
        const raw = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!raw) continue;
        const payload = JSON.parse(raw) as { text?: string; data?: AiAnalysis; message?: string };
        if (event === "token" && payload.text) onToken(payload.text);
        if (event === "done" && payload.data) result = payload.data;
        if (event === "error") throw new ApiError(payload.message || "AI stream failed", 502);
      }
      if (done) break;
    }
    if (!result) throw new ApiError("AI stream ended without a result", 502);
    return result;
  } finally {
    timeout?.cleanup();
  }
}

export async function getCompanyResearch(symbol: string): Promise<CompanyResearch> {
  return (await request<{ data: CompanyResearch }>(`/api/company/research?symbol=${encodeURIComponent(symbol)}`)).data;
}

export async function getUserState(): Promise<UserState> {
  return (await request<{ data: UserState }>("/api/user/state")).data;
}

export async function saveUserState(state: UserState): Promise<UserState> {
  return (await request<{ data: UserState }>("/api/user/state", { method: "PUT", body: JSON.stringify({ state }) })).data;
}

export async function saveUserStatePatch(patch: Partial<UserState>): Promise<UserState> {
  return (await request<{ data: UserState }>("/api/user/state", { method: "PATCH", body: JSON.stringify({ patch }) })).data;
}

export async function deleteAccountApi(): Promise<void> {
  await request<{ data: boolean }>("/api/auth/account", { method: "DELETE" });
  clearAuthSession();
}

export function startAppleLogin(): void {
  if (typeof window === "undefined") return;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.href = `/api/auth/apple/start?next=${encodeURIComponent(next)}`;
}

export async function sendAlertTestEmail(language: "zh" | "en"): Promise<{ sent: boolean; email: string }> {
  return (await request<{ data: { sent: boolean; email: string } }>("/api/alerts/test", {
    method: "POST",
    body: JSON.stringify({ language }),
  })).data;
}

export async function getHistory(asset: Asset, start: string, view: "full" | "lite" = "full"): Promise<History> {
  const params = new URLSearchParams({
    symbol: asset.symbol,
    start,
    data_source: asset.data_source,
    asset_type: asset.asset_type,
    v: "5",
    ...(view === "lite" ? { view: "lite" } : {}),
  });
  return (await request<{ data: History }>(`/api/market/history?${params}`)).data;
}

export async function getMarketSnapshots(
  symbols: string[],
  start: string,
  view: "full" | "lite" = "lite",
  include: "all" | "history" | "forecast" = "all",
): Promise<MarketSnapshot[]> {
  const params = new URLSearchParams({
    symbols: [...new Set(symbols)].slice(0, 20).join(","),
    start,
    view,
    include,
    v: "1",
  });
  return (await request<{ data: MarketSnapshot[] }>(`/api/market/snapshot?${params}`)).data;
}

export async function getPeriodReturns(symbol: string, scope: "recent" | "full" = "recent"): Promise<PeriodReturns> {
  return (await request<{ data: PeriodReturns }>(`/api/market/returns?symbol=${encodeURIComponent(symbol)}&scope=${scope}&v=5`)).data;
}

export async function compareAssets(assets: Asset[], start: string): Promise<{ series: CompareSeries[]; errors: { symbol: string; message: string }[] }> {
  return (await request<{ data: { series: CompareSeries[]; errors: { symbol: string; message: string }[] } }>("/api/compare", {
    method: "POST",
    body: JSON.stringify({ assets, start }),
  })).data;
}

export async function getForecast(symbol: string, force = false): Promise<Forecast> {
  const path = `/api/forecast/latest?symbol=${encodeURIComponent(symbol)}${force ? `&refresh=${Date.now()}` : ""}`;
  const init = force ? { cache: "no-store" as const } : undefined;
  try {
    return (await request<{ data: Forecast }>(path, init)).data;
  } catch (cause) {
    if (!(cause instanceof ApiError) || cause.status < 500) throw cause;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return (await request<{ data: Forecast }>(path, init)).data;
  }
}

export async function getPerformance(symbol: string): Promise<Performance> {
  return (await request<{ data: Performance }>(`/api/performance/${encodeURIComponent(symbol)}`)).data;
}

export async function getPredictionHistory(symbol: string): Promise<PredictionHistory> {
  return (await request<{ data: PredictionHistory }>(`/api/predictions/history/${encodeURIComponent(symbol)}`)).data;
}

export async function runForecast(asset: Asset): Promise<Record<string, unknown>> {
  return (await request<{ data: Record<string, unknown> }>("/api/forecast/run", {
    method: "POST",
    body: JSON.stringify(asset),
  })).data;
}

export async function taskStatus(taskId: string): Promise<Record<string, unknown>> {
  return (await request<{ data: Record<string, unknown> }>(`/api/forecast/status/${taskId}`)).data;
}
