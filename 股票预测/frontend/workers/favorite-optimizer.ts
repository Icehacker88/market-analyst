type KVListResult = {
  keys: Array<{ name: string }>;
  list_complete: boolean;
  cursor?: string;
};

type OrivaneKV = {
  get<T = unknown>(key: string, options?: "text" | "json" | { type?: "text" | "json" }): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<KVListResult>;
};

type Env = {
  ORIVANE_USER_STATE: OrivaneKV;
  ORIVANE_API_METRICS: OrivaneKV;
  ORIVANE_SITE_URL?: string;
  ORIVANE_FAVORITE_OPTIMIZER_LIMIT?: string;
  ORIVANE_FAVORITE_OPTIMIZER_USERS_LIMIT?: string;
  ORIVANE_FAVORITE_OPTIMIZER_DELAY_MS?: string;
  ORIVANE_OPTIMIZER_TOKEN?: string;
};

type StoredUserState = {
  watchlists?: Array<{ symbols?: unknown[] }>;
  portfolios?: Array<{ holdings?: Array<{ symbol?: unknown }> }>;
};

type OptimizeResult = {
  run_date: string;
  trigger: string;
  started_at: string;
  finished_at: string;
  site_url: string;
  total_users: number;
  total_symbols: number;
  processed_symbols: number;
  succeeded: number;
  failed: number;
  skipped: boolean;
  partition: "first" | "second" | "manual";
  core_symbols: number;
  favorite_symbols: number;
  alert_job?: { status: "ok" | "error"; message?: string };
  settlement_job?: { status: "ok" | "error"; message?: string; succeeded?: number; failed?: number };
  prewarm_job?: { status: "ok" | "partial"; succeeded: number; failed: number };
  symbols: Array<{ symbol: string; status: "ok" | "error"; message?: string }>;
};

type ScheduledController = { cron?: string; scheduledTime?: number };
type WorkerContext = { waitUntil: (promise: Promise<unknown>) => void };

const DEFAULT_SITE_URL = "https://orivane-market-intelligence.pages.dev";
const DEFAULT_SYMBOL_LIMIT = 20;
const DEFAULT_USER_LIMIT = 500;
const DEFAULT_DELAY_MS = 400;
const LATEST_KEY = "optimizer/favorites/latest.json";
const CORE_SYMBOLS = [
  "SPY", "QQQ", "AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "PLTR", "AVGO", "AMD", "TSM", "META", "TSLA", "NFLX", "ORCL", "CRM", "COIN", "HOOD", "MSTR", "SMCI", "ARM", "MU", "LLY", "BIDU", "BABA", "PDD", "JD", "NIO", "XPEV", "LI", "TME", "NTES", "BILI", "BEKE", "FUTU",
  "SOXX", "SMH", "IGV", "ARKK", "XBI", "GLD", "SLV", "IBIT", "QQQM", "^IXIC", "^NDX", "NQ=F", "MNQ=F", "^VIX",
  "600519.SH", "000001.SZ", "300965.SZ", "300750.SZ", "002594.SZ", "601318.SH", "000858.SZ", "016452.OF",
  "0700.HK", "9988.HK", "3690.HK", "9618.HK", "1211.HK", "1299.HK", "0388.HK", "1024.HK", "1810.HK", "9999.HK",
];

function numberEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

function runDate(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

function normalizeSymbol(value: unknown): string | null {
  const symbol = String(value || "").trim().toUpperCase();
  if (!symbol || symbol.length > 24) return null;
  return /^[A-Z0-9.^-]+(?:\.[A-Z]{2,4})?$/.test(symbol) ? symbol : null;
}

function symbolsFromState(state: StoredUserState | null): string[] {
  if (!state) return [];
  const watchlistSymbols = (state.watchlists || []).flatMap((list) => list.symbols || []);
  const portfolioSymbols = (state.portfolios || []).flatMap((portfolio) => (portfolio.holdings || []).map((holding) => holding.symbol));
  return [...new Set([...watchlistSymbols, ...portfolioSymbols].map(normalizeSymbol).filter((symbol): symbol is string => Boolean(symbol)))];
}

async function listUserStateKeys(env: Env, maxUsers: number): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.ORIVANE_USER_STATE.list({ prefix: "users/", cursor, limit: 1000 });
    for (const key of page.keys) {
      if (key.name.endsWith(".json")) keys.push(key.name);
      if (keys.length >= maxUsers) return keys;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

async function favoriteSymbols(env: Env): Promise<{ totalUsers: number; symbols: string[] }> {
  const maxUsers = numberEnv(env.ORIVANE_FAVORITE_OPTIMIZER_USERS_LIMIT, DEFAULT_USER_LIMIT, 1, 5000);
  const maxSymbols = numberEnv(env.ORIVANE_FAVORITE_OPTIMIZER_LIMIT, DEFAULT_SYMBOL_LIMIT, 1, 200);
  const keys = await listUserStateKeys(env, maxUsers);
  const counts = new Map<string, number>();
  for (const key of keys) {
    const state = await env.ORIVANE_USER_STATE.get<StoredUserState>(key, "json").catch(() => null);
    for (const symbol of symbolsFromState(state)) counts.set(symbol, (counts.get(symbol) || 0) + 1);
  }
  const symbols = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([symbol]) => symbol)
    .slice(0, maxSymbols);
  return { totalUsers: keys.length, symbols };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function prewarmPublicData(siteUrl: string, symbols: string[]): Promise<NonNullable<OptimizeResult["prewarm_job"]>> {
  const oneYearStart = new Date(Date.now() - 370 * 86400000).toISOString().slice(0, 10);
  const chunks = Array.from({ length: Math.ceil(symbols.length / 10) }, (_, index) => symbols.slice(index * 10, index * 10 + 10));
  const endpoints = [
    "/api/home",
    "/api/forecast/scoreboard",
    "/api/screener?v=5",
    "/api/recommendations?v=6",
    ...chunks.flatMap((chunk) => [
      `/api/market/snapshot?symbols=${encodeURIComponent(chunk.join(","))}&start=${oneYearStart}&view=lite&include=all&v=1`,
      `/api/market/snapshot?symbols=${encodeURIComponent(chunk.join(","))}&start=1900-01-01&view=lite&include=history&v=1`,
    ]),
  ];
  const settled = await Promise.allSettled(endpoints.map(async (path) => {
    const response = await fetch(`${siteUrl}${path}`, { headers: { "x-orivane-prewarm": "1" }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    await response.arrayBuffer();
  }));
  const succeeded = settled.filter((item) => item.status === "fulfilled").length;
  return { status: succeeded === endpoints.length ? "ok" : "partial", succeeded, failed: endpoints.length - succeeded };
}

async function runFavoriteOptimizer(env: Env, trigger: string, force = false): Promise<OptimizeResult> {
  const startedAt = new Date().toISOString();
  const today = runDate();
  const siteUrl = (env.ORIVANE_SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, "");
  const partition: OptimizeResult["partition"] = trigger === "manual" ? "manual" : trigger.includes("45 0") ? "second" : "first";
  const previous = await env.ORIVANE_API_METRICS.get<OptimizeResult>(LATEST_KEY, "json").catch(() => null);
  if (!force && previous?.run_date === today && previous.partition === partition && !previous.skipped) {
    return { ...previous, trigger, skipped: true, finished_at: new Date().toISOString() };
  }

  const { totalUsers, symbols: allFavoriteSymbols } = await favoriteSymbols(env);
  const coreSymbols = partition === "manual" ? [] : CORE_SYMBOLS.filter((_, index) => index % 2 === (partition === "second" ? 1 : 0));
  const favoriteSymbolsForRun = partition === "manual" ? allFavoriteSymbols : allFavoriteSymbols.filter((_, index) => index % 2 === (partition === "second" ? 1 : 0));
  const delayMs = numberEnv(env.ORIVANE_FAVORITE_OPTIMIZER_DELAY_MS, DEFAULT_DELAY_MS, 0, 5000);
  const results: OptimizeResult["symbols"] = [];
  const endpoint = `${siteUrl}/api/forecast/run`;

  const favoriteSet = new Set(favoriteSymbolsForRun);
  const jobs = [
    ...coreSymbols.map((symbol) => ({ symbol, optimize: favoriteSet.has(symbol) })),
    ...favoriteSymbolsForRun.filter((symbol) => !coreSymbols.includes(symbol)).map((symbol) => ({ symbol, optimize: true })),
  ];
  for (const job of jobs) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-orivane-job": "favorite-optimizer",
          ...(env.ORIVANE_OPTIMIZER_TOKEN ? { authorization: `Bearer ${env.ORIVANE_OPTIMIZER_TOKEN}` } : {}),
        },
        body: JSON.stringify(job),
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      results.push({ symbol: job.symbol, status: "ok" });
    } catch (cause) {
      results.push({ symbol: job.symbol, status: "error", message: cause instanceof Error ? cause.message : "unknown_error" });
    }
    if (delayMs) await wait(delayMs);
  }

  let settlementJob: OptimizeResult["settlement_job"];
  try {
    const response = await fetch(`${siteUrl}/api/forecast/settle`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(env.ORIVANE_OPTIMIZER_TOKEN ? { authorization: `Bearer ${env.ORIVANE_OPTIMIZER_TOKEN}` } : {}) },
      body: JSON.stringify({ symbols: jobs.map((job) => job.symbol) }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { data?: { succeeded?: number; failed?: number } };
    settlementJob = { status: "ok", succeeded: Number(payload.data?.succeeded || 0), failed: Number(payload.data?.failed || 0) };
  } catch (cause) {
    settlementJob = { status: "error", message: cause instanceof Error ? cause.message : "unknown_error" };
  }

  let alertJob: OptimizeResult["alert_job"];
  if (partition === "second" || partition === "manual") {
    try {
      const response = await fetch(`${siteUrl}/api/alerts/process`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(env.ORIVANE_OPTIMIZER_TOKEN ? { authorization: `Bearer ${env.ORIVANE_OPTIMIZER_TOKEN}` } : {}) },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      alertJob = { status: "ok" };
    } catch (cause) {
      alertJob = { status: "error", message: cause instanceof Error ? cause.message : "unknown_error" };
    }
  }

  const prewarmJob = await prewarmPublicData(siteUrl, jobs.map((job) => job.symbol));

  const finishedAt = new Date().toISOString();
  const result: OptimizeResult = {
    run_date: today,
    trigger,
    started_at: startedAt,
    finished_at: finishedAt,
    site_url: siteUrl,
    total_users: totalUsers,
    total_symbols: results.length,
    processed_symbols: results.length,
    succeeded: results.filter((item) => item.status === "ok").length,
    failed: results.filter((item) => item.status === "error").length,
    skipped: false,
    partition,
    core_symbols: coreSymbols.length,
    favorite_symbols: favoriteSymbolsForRun.length,
    ...(alertJob ? { alert_job: alertJob } : {}),
    settlement_job: settlementJob,
    prewarm_job: prewarmJob,
    symbols: results,
  };

  await env.ORIVANE_API_METRICS.put(LATEST_KEY, JSON.stringify(result));
  await env.ORIVANE_API_METRICS.put(`optimizer/favorites/runs/${today}-${startedAt.replace(/[:.]/g, "-")}.json`, JSON.stringify(result));
  return result;
}

function authorized(request: Request, env: Env): boolean {
  const token = env.ORIVANE_OPTIMIZER_TOKEN;
  if (!token) return false;
  return request.headers.get("authorization") === `Bearer ${token}`;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/status") {
      if (!authorized(request, env)) return json({ error: "forbidden" }, 403);
      return json({ data: await env.ORIVANE_API_METRICS.get<OptimizeResult>(LATEST_KEY, "json").catch(() => null) });
    }
    if (request.method === "POST" && url.pathname === "/run") {
      if (!authorized(request, env)) return json({ error: "forbidden" }, 403);
      return json({ data: await runFavoriteOptimizer(env, "manual", url.searchParams.get("force") === "1") });
    }
    return json({ ok: true, service: "orivane-favorite-optimizer" });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: WorkerContext): Promise<void> {
    ctx.waitUntil(runFavoriteOptimizer(env, `cron:${controller.cron || "daily"}`));
  },
};
