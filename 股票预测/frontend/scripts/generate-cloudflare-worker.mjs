import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root, "netlify/functions/api.mts");
const outputPath = path.join(root, "functions/api/[[path]].ts");

const prefix = `type CloudflareKV = {
  get: (key: string, options?: "text" | "json" | "arrayBuffer" | { type?: "text" | "json" | "arrayBuffer" }) => Promise<unknown>;
  put: (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: { expirationTtl?: number }) => Promise<void>;
  delete: (key: string) => Promise<void>;
  list: (options?: { prefix?: string; cursor?: string; limit?: number }) => Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }>;
};

type CloudflareEnv = {
  ORIVANE_API_CACHE?: CloudflareKV;
  ORIVANE_API_METRICS?: CloudflareKV;
  ORIVANE_ASSET_LOGOS?: CloudflareKV;
  ORIVANE_USER_STATE?: CloudflareKV;
  ORIVANE_AI_USAGE?: CloudflareKV;
  ORIVANE_CLOUD_FORECASTS?: CloudflareKV;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  ORIVANE_AI_DAILY_LIMIT?: string;
  ORIVANE_ADMIN_EMAILS?: string;
  ORIVANE_PASSWORD_AUTH_ENABLED?: string;
  ORIVANE_PASSWORD_SIGNUP_ENABLED?: string;
  ORIVANE_TURNSTILE_SITE_KEY?: string;
  ORIVANE_TURNSTILE_SECRET_KEY?: string;
  ORIVANE_MARKET_DATA_PROVIDER?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  ORIVANE_EMAIL_FROM?: string;
  ORIVANE_OPTIMIZER_TOKEN?: string;
};

type Context = {
  geo?: { country?: { code?: string } };
  deploy?: { context?: string };
  waitUntil: (promise: Promise<unknown>) => void;
};

type PagesFunction<E = CloudflareEnv> = (context: { request: Request; env: E; waitUntil: (promise: Promise<unknown>) => void }) => Promise<Response> | Response;
type CloudflareCache = { match: (request: Request) => Promise<Response | undefined>; put: (request: Request, response: Response) => Promise<void> };
function cloudflareDependencies(env: CloudflareEnv): ApiDependencies {
  const config: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === "string") config[name] = value;
  }

  function getStore({ name }: ApiStoreOptions): ApiStore {
    const binding = ({
      "orivane-api-cache": "ORIVANE_API_CACHE",
      "orivane-api-metrics": "ORIVANE_API_METRICS",
      "orivane-asset-logos": "ORIVANE_ASSET_LOGOS",
      "orivane-user-state": "ORIVANE_USER_STATE",
      "orivane-ai-usage": "ORIVANE_AI_USAGE",
      "orivane-cloud-forecasts": "ORIVANE_CLOUD_FORECASTS",
    } as Record<string, keyof CloudflareEnv>)[name];
    const kv = binding ? env[binding] as CloudflareKV | undefined : undefined;
    if (!kv) throw new Error("Missing Cloudflare KV binding: " + (binding || name));
    return {
      get: (key, options) => kv.get(key, options?.type || "text"),
      set: (key, value) => kv.put(key, value),
      setJSON: (key, value) => kv.put(key, JSON.stringify(value), key.startsWith("auth/attempts/") ? { expirationTtl: 900 } : undefined),
      delete: (key) => kv.delete(key),
      list: async (options) => {
        const result = await kv.list({ prefix: options?.prefix, limit: 1000 });
        return { blobs: result.keys.map((item) => ({ key: item.name })) };
      },
    };
  }

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = config.RESEND_API_KEY;
  const from = config.ORIVANE_EMAIL_FROM;
  if (!apiKey || !from) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: \`Bearer \${apiKey}\`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  return response.ok;
}

  return { env: config, getStore, getDeployStore: getStore, sendEmail };
}
`;

let source = await readFile(sourcePath, "utf8");
const replacements = [
  ['from "./_shared/forecast-eligibility"', 'from "../../netlify/functions/_shared/forecast-eligibility"'],
  ['from "./_shared/password"', 'from "../../netlify/functions/_shared/password"'],
  ['import type { Config, Context } from "@netlify/functions";\n', ""],
  ['import { getDeployStore, getStore } from "@netlify/blobs";\n', ""],
  ['import publicData from "./data/public-data.json" with { type: "json" };', 'import publicData from "../../netlify/functions/data/public-data.json" with { type: "json" };'],
  ['import { sendEmail } from "./_shared/market-email.ts";\n', ""],
  ['export default (request: Request, context: Context): Promise<Response> =>\n  createApi({ env: process.env, getStore, getDeployStore, sendEmail }).handle(request, context);', ""],
  ['\nexport const config: Config = { path: "/api/*" };\n', ""],
];
for (const [from, to] of replacements) {
  if (!source.includes(from)) throw new Error("Cloudflare source adapter no longer matches: " + from.split("\n")[0]);
  source = source.replace(from, to);
}

const suffix = `

const EDGE_CACHE_PATHS = new Set([
  "/api/health",
  "/api/home",
  "/api/forecast/scoreboard",
  "/api/market/gainers",
  "/api/market/overview",
  "/api/screener",
  "/api/recommendations",
]);

function edgeCacheable(request: Request): boolean {
  if (request.method !== "GET" || request.headers.has("authorization")) return false;
  if (new URL(request.url).pathname === "/api/market/snapshot" && new URL(request.url).searchParams.has("mode")) return false;
  const path = new URL(request.url).pathname.replace(/\\/$/, "");
  return EDGE_CACHE_PATHS.has(path)
    || path === "/api/assets/search"
    || path === "/api/assets/logo"
    || path === "/api/market/history"
    || path === "/api/market/snapshot"
    || path === "/api/market/returns"
    || path === "/api/forecast/latest";
}

function edgeResponse(response: Response, status: "HIT" | "MISS" | "BYPASS"): Response {
  const headers = new Headers(response.headers);
  headers.set("x-orivane-edge-cache", status);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export const onRequest: PagesFunction = async ({ request, env, waitUntil }) => {
  const { handle, recordCacheMetric } = createApi(cloudflareDependencies(env));
  const country = (request as Request & { cf?: { country?: string } }).cf?.country;
  const cache = (globalThis as typeof globalThis & { caches?: { default?: CloudflareCache } }).caches?.default;
  const cacheUrl = new URL(request.url);
  if (cacheUrl.pathname.replace(/\\/$/, "") === "/api/forecast/scoreboard") cacheUrl.searchParams.set("__evaluation_protocol", "frozen-close-v1");
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  if (cache && edgeCacheable(request)) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      if (Math.random() < METRIC_SAMPLE_RATE) waitUntil(recordCacheMetric(\`edge/\${new URL(request.url).pathname}\`, "hit"));
      return edgeResponse(cached, "HIT");
    }
  }
  const response = await handle(request, {
    geo: country ? { country: { code: country } } : undefined,
    deploy: { context: "production" },
    waitUntil,
  });
  if (cache && edgeCacheable(request) && response.ok && !response.headers.get("cache-control")?.includes("private")) {
    if (Math.random() < METRIC_SAMPLE_RATE) waitUntil(recordCacheMetric(\`edge/\${new URL(request.url).pathname}\`, "miss"));
    waitUntil(cache.put(cacheKey, response.clone()).catch(() => undefined));
    return edgeResponse(response, "MISS");
  }
  return edgeResponse(response, "BYPASS");
};
`;

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${prefix}\n${source}${suffix}`);
console.log(`Generated ${path.relative(root, outputPath)}`);
