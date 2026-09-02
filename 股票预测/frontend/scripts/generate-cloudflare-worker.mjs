import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(root, "netlify/functions/api.mts");
const outputPath = path.join(root, "functions/api/[[path]].ts");

const prefix = `type CloudflareKV = {
  get: (key: string, options?: "text" | "json" | "arrayBuffer" | { type?: "text" | "json" | "arrayBuffer" }) => Promise<unknown>;
  put: (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream) => Promise<void>;
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
type CloudflareUser = { id: string; email?: string | null; name?: string; pictureUrl?: string | null; confirmedAt?: string };

let ACTIVE_ENV: CloudflareEnv = {};
let ACTIVE_REQUEST: Request | null = null;
const MEMORY_KV = new Map<string, Map<string, string | ArrayBuffer>>();

function envValue(name: string): string | undefined {
  return ACTIVE_ENV[name as keyof CloudflareEnv] as string | undefined;
}

const process = {
  env: new Proxy({}, {
    get: (_target, property) => envValue(String(property)),
  }) as Record<string, string | undefined>,
};

function memoryNamespace(name: string) {
  if (!MEMORY_KV.has(name)) MEMORY_KV.set(name, new Map());
  const store = MEMORY_KV.get(name)!;
  return {
    async get(key: string, options?: "text" | "json" | "arrayBuffer" | { type?: "text" | "json" | "arrayBuffer" }) {
      const value = store.get(key);
      if (value === undefined) return null;
      const type = typeof options === "string" ? options : options?.type;
      if (type === "arrayBuffer") return typeof value === "string" ? new TextEncoder().encode(value).buffer : value;
      const text = typeof value === "string" ? value : new TextDecoder().decode(value);
      return type === "json" ? JSON.parse(text) : text;
    },
    async put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream) {
      if (value instanceof ReadableStream) {
        store.set(key, await new Response(value).arrayBuffer());
      } else if (typeof value === "string" || value instanceof ArrayBuffer) {
        store.set(key, value);
      } else {
        const copy = new Uint8Array(value.byteLength);
        copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        store.set(key, copy.buffer);
      }
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(options?: { prefix?: string; cursor?: string; limit?: number }) {
      const names = [...store.keys()].filter((key) => !options?.prefix || key.startsWith(options.prefix));
      return { keys: names.slice(0, options?.limit || 1000).map((name) => ({ name })), list_complete: true };
    },
  };
}

function kvForStore(name: string): CloudflareKV {
  const binding = ({
    "orivane-api-cache": "ORIVANE_API_CACHE",
    "orivane-api-metrics": "ORIVANE_API_METRICS",
    "orivane-asset-logos": "ORIVANE_ASSET_LOGOS",
    "orivane-user-state": "ORIVANE_USER_STATE",
    "orivane-ai-usage": "ORIVANE_AI_USAGE",
    "orivane-cloud-forecasts": "ORIVANE_CLOUD_FORECASTS",
  } as Record<string, keyof CloudflareEnv>)[name];
  const kv = binding ? ACTIVE_ENV[binding] as CloudflareKV | undefined : undefined;
  return kv || memoryNamespace(name);
}

function getStore({ name }: { name: string; consistency?: string }) {
  const kv = kvForStore(name);
  return {
    get: async (key: string, options?: { type?: "json" | "arrayBuffer" | "text" }): Promise<any> => kv.get(key, options?.type || "text"),
    set: (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream) => kv.put(key, value),
    setJSON: (key: string, value: unknown) => kv.put(key, JSON.stringify(value)),
    delete: (key: string) => kv.delete(key),
    list: async (options?: { prefix?: string }) => {
      const result = await kv.list({ prefix: options?.prefix, limit: 1000 });
      return { blobs: result.keys.map((item) => ({ key: item.name, etag: "" })), directories: [] };
    },
  };
}

function getDeployStore(options: { name: string; consistency?: string }) {
  return getStore(options);
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

async function getUser(): Promise<CloudflareUser | null> {
  const header = ACTIVE_REQUEST?.headers.get("authorization") || "";
  const token = header.match(/^Bearer\\s+(.+)$/i)?.[1];
  if (!token) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(token.split(".")[1] || "")) as {
      sub?: string;
      email?: string;
      exp?: number;
      user_metadata?: { full_name?: string; name?: string; avatar_url?: string };
      app_metadata?: { roles?: string[] };
    };
    if (!payload.sub || (payload.exp && payload.exp < Math.floor(Date.now() / 1000))) return null;
    return { id: payload.sub, email: payload.email || null };
  } catch {
    return null;
  }
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = envValue("RESEND_API_KEY");
  const from = envValue("ORIVANE_EMAIL_FROM");
  if (!apiKey || !from) return false;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: \`Bearer \${apiKey}\`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  return response.ok;
}
`;

let source = await readFile(sourcePath, "utf8");
source = source
  .replace('import type { Config, Context } from "@netlify/functions";\n', "")
  .replace('import { getDeployStore, getStore } from "@netlify/blobs";\n', "")
  .replace('import { getUser } from "@netlify/identity";\n', "")
  .replace('import publicData from "./data/public-data.json" with { type: "json" };', 'import publicData from "../../netlify/functions/data/public-data.json" with { type: "json" };')
  .replace('import { sendEmail } from "./_shared/market-email.ts";\n', "")
  .replace("export default async (request: Request, context: Context): Promise<Response> => {", "const netlifyHandler = async (request: Request, context: Context): Promise<Response> => {")
  .replace('\nexport const config: Config = { path: "/api/*" };\n', "");

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
  ACTIVE_ENV = env;
  ACTIVE_REQUEST = request;
  const country = (request as Request & { cf?: { country?: string } }).cf?.country;
  const cache = (globalThis as typeof globalThis & { caches?: { default?: CloudflareCache } }).caches?.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  if (cache && edgeCacheable(request)) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      if (Math.random() < METRIC_SAMPLE_RATE) waitUntil(recordCacheMetric(\`edge/\${new URL(request.url).pathname}\`, "hit"));
      return edgeResponse(cached, "HIT");
    }
  }
  const response = await netlifyHandler(request, {
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
