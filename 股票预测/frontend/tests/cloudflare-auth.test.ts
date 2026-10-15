// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/[[path]]";

type WorkerEnv = Parameters<typeof onRequest>[0]["env"];
type JsonRecord = Record<string, unknown>;

class TestKv {
  readonly values = new Map<string, string>();
  beforeGet?: (key: string) => Promise<void>;

  async get(key: string, options?: unknown): Promise<unknown> {
    await this.beforeGet?.(key);
    const value = this.values.get(key);
    if (value === undefined) return null;
    const type = typeof options === "string" ? options : (options as { type?: string } | undefined)?.type;
    return type === "json" ? JSON.parse(value) : value;
  }

  async put(key: string, value: unknown): Promise<void> {
    if (typeof value !== "string") throw new Error("This test expects JSON/text KV writes.");
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async list(options?: { prefix?: string; limit?: number }) {
    const names = [...this.values.keys()].filter((key) => key.startsWith(options?.prefix || ""));
    return { keys: names.slice(0, options?.limit || 1000).map((name) => ({ name })), list_complete: true };
  }

  seed(key: string, value: unknown) {
    this.values.set(key, JSON.stringify(value));
  }

  json(key: string): JsonRecord | undefined {
    const value = this.values.get(key);
    return value === undefined ? undefined : JSON.parse(value) as JsonRecord;
  }
}

const SESSION_TOKEN = "00000000-0000-4000-8000-000000000001";
const OTHER_TOKEN = "00000000-0000-4000-8000-000000000002";
const sessionKey = (token = SESSION_TOKEN) => `auth/sessions/${token}.json`;
const accountKey = (email: string) => `auth/users/${encodeURIComponent(email)}.json`;
const stateKey = (id: string) => `users/${id}.json`;

function fixture(id = "alice", email = "alice@example.test", token = SESSION_TOKEN) {
  const users = new TestKv();
  const metrics = new TestKv();
  const account = { id, email, name: id, salt: "", password_hash: "", created_at: "2026-01-01T00:00:00.000Z" };
  const session = { token, user_id: id, email, expires_at: new Date(Date.now() + 86_400_000).toISOString() };
  users.seed(accountKey(email), account);
  users.seed(sessionKey(token), session);
  users.seed(stateKey(id), { account_email: email, watchlists: [{ id: "default", name: id, symbols: ["SPY"] }], state_revision: 1 });
  const env: WorkerEnv = {
    ORIVANE_USER_STATE: users,
    ORIVANE_API_METRICS: metrics,
    ORIVANE_API_CACHE: new TestKv(),
    ORIVANE_AI_USAGE: new TestKv(),
    ORIVANE_CLOUD_FORECASTS: new TestKv(),
    ORIVANE_ASSET_LOGOS: new TestKv(),
  };
  return { env, users, metrics, account, session };
}

type RequestOptions = { method?: string; token?: string; headers?: HeadersInit; body?: unknown };

async function request(env: WorkerEnv, path: string, options: RequestOptions = {}) {
  const headers = new Headers(options.headers);
  if (!headers.has("origin")) headers.set("origin", "https://app.example.test");
  if (options.token) headers.set("cookie", `orivane_session=${encodeURIComponent(options.token)}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const background: Promise<unknown>[] = [];
  const response = await onRequest({
    request: new Request(`https://app.example.test/api${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    env,
    waitUntil: (promise) => { background.push(promise); },
  });
  await Promise.all(background);
  return response;
}

function unsignedJwt(id = "alice", email = "alice@example.test") {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ sub: id, email, exp: Math.floor(Date.now() / 1000) + 3600 })}.arbitrary-signature`;
}

function pauseFirstSessionRead(kv: TestKv) {
  let signalStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const resumed = new Promise<void>((resolve) => { release = resolve; });
  let paused = false;
  kv.beforeGet = async (key) => {
    if (key !== sessionKey() || paused) return;
    paused = true;
    signalStarted();
    await resumed;
  };
  return { started, release };
}

async function waitForPaused(pause: ReturnType<typeof pauseFirstSessionRead>, pending: Promise<Response>) {
  await Promise.race([
    pause.started,
    pending.then(() => { throw new Error("Request completed without reaching the expected session lookup."); }),
  ]);
}

const protectedRoutes = [
  { path: "/user/state", method: "GET", status: 401 },
  { path: "/user/state", method: "PUT", body: { state: { watchlists: [] } }, status: 401 },
  { path: "/user/state", method: "PATCH", body: { patch: { watchlists: [] } }, status: 401 },
  { path: "/auth/account", method: "DELETE", status: 401 },
  { path: "/alerts/test", method: "POST", body: { language: "en" }, status: 401 },
  { path: "/admin/metrics", method: "GET", status: 403 },
  { path: "/forecast/run", method: "POST", body: {}, status: 401 },
] as const;

beforeEach(() => {
  vi.spyOn(Math, "random").mockReturnValue(1);
  vi.stubGlobal("caches", undefined);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected network access in authentication regression test."); }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("generated Cloudflare API session authentication", () => {
  it("keeps email signup, login and their existing cookie-session structure working", async () => {
    const { env, users } = fixture();
    Object.assign(env, { ORIVANE_PASSWORD_AUTH_ENABLED: "true", ORIVANE_PASSWORD_SIGNUP_ENABLED: "true", ORIVANE_TURNSTILE_SITE_KEY: "local-test-key", ORIVANE_TURNSTILE_SECRET_KEY: "local-test-secret" });
    vi.mocked(fetch).mockImplementation(async (_url, init) => Response.json({ success: true, hostname: "app.example.test", action: JSON.parse(String(init?.body)).response }));
    const credentials = { email: "new@example.test", password: "test-password-only", name: "New user", challengeToken: "signup" };
    const signup = await request(env, "/auth/signup", { method: "POST", body: credentials });
    expect(signup.status).toBe(200);
    const created = await signup.json() as { data: { user: { id: string; email: string } } };
    const cookieHeader = signup.headers.get("set-cookie")!;
    expect(cookieHeader).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(created.data).not.toHaveProperty("token");
    const signupToken = decodeURIComponent(cookieHeader.match(/orivane_session=([^;]+)/)![1]);
    expect(users.json(sessionKey(signupToken))).toMatchObject({ token: signupToken, user_id: created.data.user.id, email: credentials.email });
    expect(await (await request(env, "/auth/me", { token: signupToken })).json()).toMatchObject({ data: created.data.user });
    const login = await request(env, "/auth/login", { method: "POST", body: { ...credentials, challengeToken: "login" } });
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ data: { user: { id: created.data.user.id } } });
    expect((await request(env, "/auth/login", { method: "POST", body: { ...credentials, password: "wrong-password", challengeToken: "login" } })).status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each(protectedRoutes)("rejects forged JWT claims on $method $path", async ({ path, status, ...options }) => {
    const { env, users } = fixture();
    env.ORIVANE_ADMIN_EMAILS = "alice@example.test";
    const before = [...users.values.entries()];
    const response = await request(env, path, { ...options, headers: { authorization: `Bearer ${unsignedJwt()}` } });
    expect(response.status).toBe(status);
    expect([...users.values.entries()]).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects missing sessions on every private route", async () => {
    const { env } = fixture();
    for (const { path, status, ...options } of protectedRoutes) {
      expect((await request(env, path, options)).status).toBe(status);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not turn a forged Bearer JWT or Cloudflare Access assertion into an application user", async () => {
    const { env } = fixture();
    const untrustedHeaders: HeadersInit[] = [
      { authorization: `Bearer ${unsignedJwt()}` },
      { "cf-access-jwt-assertion": unsignedJwt(), "cf-access-authenticated-user-email": "alice@example.test" },
      { cookie: `CF_Authorization=${unsignedJwt()}` },
    ];
    for (const headers of untrustedHeaders) {
      const response = await request(env, "/auth/me", { headers });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: null });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts a verified session cookie even when unrelated Authorization claims are present", async () => {
    const { env } = fixture();
    const response = await request(env, "/auth/me", {
      token: SESSION_TOKEN,
      headers: { authorization: `Bearer ${unsignedJwt("mallory", "mallory@example.test")}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { id: "alice", email: "alice@example.test" } });
    expect(response.headers.get("cache-control")).toContain("private");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not accept an opaque application session in Authorization or revoke it via Bearer logout", async () => {
    const { env, users } = fixture();
    const headers = { authorization: `Bearer ${SESSION_TOKEN}` };
    expect(await (await request(env, "/auth/me", { headers })).json()).toEqual({ data: null });
    expect((await request(env, "/user/state", { headers })).status).toBe(401);
    expect((await request(env, "/auth/logout", { method: "POST", headers })).status).toBe(200);
    expect(users.json(sessionKey())).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  const invalidSessions: Array<{ name: string; corrupt: (data: ReturnType<typeof fixture>) => void }> = [
    { name: "missing session", corrupt: ({ users }) => { users.values.delete(sessionKey()); } },
    { name: "malformed session JSON", corrupt: ({ users }) => { users.values.set(sessionKey(), "{broken"); } },
    { name: "expired session", corrupt: ({ users, session }) => users.seed(sessionKey(), { ...session, expires_at: "2000-01-01T00:00:00.000Z" }) },
    { name: "invalid expiration", corrupt: ({ users, session }) => users.seed(sessionKey(), { ...session, expires_at: "not-a-date" }) },
    { name: "missing expiration", corrupt: ({ users, session }) => users.seed(sessionKey(), { ...session, expires_at: undefined }) },
    { name: "token mismatch", corrupt: ({ users, session }) => users.seed(sessionKey(), { ...session, token: OTHER_TOKEN }) },
    { name: "missing user id", corrupt: ({ users, session }) => users.seed(sessionKey(), { ...session, user_id: undefined }) },
    { name: "missing email", corrupt: ({ users, session }) => users.seed(sessionKey(), { ...session, email: undefined }) },
    { name: "missing account", corrupt: ({ users, account }) => { users.values.delete(accountKey(account.email)); } },
    { name: "user id mismatch", corrupt: ({ users, account }) => users.seed(accountKey(account.email), { ...account, id: "different-user" }) },
    { name: "account email mismatch", corrupt: ({ users, account }) => users.seed(accountKey(account.email), { ...account, email: "different@example.test" }) },
    { name: "session lookup error", corrupt: ({ users }) => { users.beforeGet = async (key) => { if (key === sessionKey()) throw new Error("session store unavailable"); }; } },
    { name: "account lookup error", corrupt: ({ users, account }) => { users.beforeGet = async (key) => { if (key === accountKey(account.email)) throw new Error("account store unavailable"); }; } },
  ];

  it.each(invalidSessions)("fails closed for $name", async ({ corrupt }) => {
    const data = fixture();
    corrupt(data);
    const before = data.users.values.get(stateKey("alice"));
    const auth = await request(data.env, "/auth/me", { token: SESSION_TOKEN });
    expect(auth.status).toBe(200);
    expect(await auth.json()).toEqual({ data: null });
    const write = await request(data.env, "/user/state", { method: "PATCH", token: SESSION_TOKEN, body: { patch: { watchlists: [] } } });
    expect(write.status).toBe(401);
    expect(data.users.values.get(stateKey("alice"))).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects anonymous and malformed-cookie requests", async () => {
    const { env } = fixture();
    const unauthenticatedHeaders: HeadersInit[] = [{}, { cookie: "orivane_session=%E0%A4%A" }];
    for (const headers of unauthenticatedHeaders) {
      expect(await (await request(env, "/auth/me", { headers })).json()).toEqual({ data: null });
      expect((await request(env, "/user/state", { headers })).status).toBe(401);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed when the user-state storage binding is unavailable", async () => {
    const { env } = fixture();
    delete env.ORIVANE_USER_STATE;
    expect(await (await request(env, "/auth/me", { token: SESSION_TOKEN })).json()).toEqual({ data: null });
    expect((await request(env, "/user/state", { token: SESSION_TOKEN })).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("supports state GET, PUT and PATCH using only the verified account id and email", async () => {
    const { env, users } = fixture();
    const initial = await request(env, "/user/state", { token: SESSION_TOKEN });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ data: { account_email: "alice@example.test", state_revision: 1 } });
    const replacement = await request(env, "/user/state", {
      method: "PUT", token: SESSION_TOKEN,
      body: { state: { account_email: "mallory@example.test", watchlists: [{ id: "default", symbols: ["QQQ"] }] } },
    });
    expect(replacement.status).toBe(200);
    expect(await replacement.json()).toMatchObject({ data: { account_email: "alice@example.test", state_revision: 2 } });
    const patch = await request(env, "/user/state", { method: "PATCH", token: SESSION_TOKEN, body: { patch: { research_reviews: { SPY: { note: "kept" } } } } });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ data: { watchlists: [{ symbols: ["QQQ"] }], research_reviews: { SPY: { note: "kept" } }, state_revision: 3 } });
    expect(users.json(stateKey("alice"))).toMatchObject({ account_email: "alice@example.test", state_revision: 3 });
    expect(users.json(stateKey("mallory"))).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a queued write for Alice when its cookie now belongs to Bob", async () => {
    const { env, users } = fixture("bob", "bob@example.test");
    const before = users.values.get(stateKey("bob"));
    const response = await request(env, "/user/state", {
      method: "PATCH", token: SESSION_TOKEN,
      headers: { "x-orivane-user-id": "alice" },
      body: { patch: { research_reviews: { owner: "alice" } } },
    });
    expect(response.status).toBe(403);
    expect(users.values.get(stateKey("bob"))).toBe(before);
    expect(users.json(stateKey("alice"))).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("treats the expected-user header only as a guard, never as authentication", async () => {
    const { env } = fixture();
    expect((await request(env, "/user/state", { headers: { "x-orivane-user-id": "alice" } })).status).toBe(401);
    expect((await request(env, "/user/state", { token: SESSION_TOKEN, headers: { "x-orivane-user-id": "alice" } })).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("revokes the cookie session on logout", async () => {
    const { env, users } = fixture();
    const response = await request(env, "/auth/logout", { method: "POST", token: SESSION_TOKEN });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(users.json(sessionKey())).toBeUndefined();
    expect(await (await request(env, "/auth/me", { token: SESSION_TOKEN })).json()).toEqual({ data: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { path: "/auth/account", method: "DELETE" },
    { path: "/auth/logout", method: "POST" },
  ])("rejects a stale account action on $path when the cookie belongs to Bob", async ({ path, method }) => {
    const { env, users } = fixture("bob", "bob@example.test");
    const before = [...users.values.entries()];
    const response = await request(env, path, {
      method, token: SESSION_TOKEN, headers: { "x-orivane-user-id": "alice" },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect([...users.values.entries()]).toEqual(before);
  });

  it("deletes only the verified user's account, state and sessions", async () => {
    const { env, users, session } = fixture();
    users.seed(sessionKey(OTHER_TOKEN), { ...session, token: OTHER_TOKEN });
    users.seed(accountKey("bob@example.test"), { id: "bob", email: "bob@example.test" });
    users.seed(stateKey("bob"), { account_email: "bob@example.test", watchlists: [] });
    users.seed("auth/sessions/bob.json", { token: "bob", user_id: "bob", email: "bob@example.test", expires_at: session.expires_at });
    const response = await request(env, "/auth/account", { method: "DELETE", token: SESSION_TOKEN });
    expect(response.status).toBe(200);
    expect(users.json(accountKey("alice@example.test"))).toBeUndefined();
    expect(users.json(stateKey("alice"))).toBeUndefined();
    expect(users.json(sessionKey())).toBeUndefined();
    expect(users.json(sessionKey(OTHER_TOKEN))).toBeUndefined();
    expect(users.json(accountKey("bob@example.test"))).toBeDefined();
    expect(users.json(stateKey("bob"))).toBeDefined();
    expect(users.json("auth/sessions/bob.json")).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends alert tests only to the verified session email", async () => {
    const { env } = fixture();
    env.RESEND_API_KEY = "test-resend-alice";
    env.ORIVANE_EMAIL_FROM = "alerts@app.example.test";
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));
    const response = await request(env, "/alerts/test", {
      method: "POST", token: SESSION_TOKEN,
      headers: { authorization: `Bearer ${unsignedJwt("mallory", "mallory@example.test")}` },
      body: { language: "en", email: "mallory@example.test" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { sent: true, email: "alice@example.test" } });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-resend-alice");
    expect(JSON.parse(String(init?.body))).toMatchObject({ to: ["alice@example.test"], from: "alerts@app.example.test" });
  });

  it("authorizes admin metrics by verified session email", async () => {
    const { env } = fixture();
    env.ORIVANE_ADMIN_EMAILS = "admin@example.test";
    expect((await request(env, "/admin/metrics", { token: SESSION_TOKEN })).status).toBe(403);
    env.ORIVANE_ADMIN_EMAILS = "alice@example.test";
    expect((await request(env, "/admin/metrics", { token: SESSION_TOKEN })).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("derives admin hints only from the current environment and rejects client privilege claims", async () => {
    const { env } = fixture();
    env.ORIVANE_ADMIN_EMAILS = " alice@example.test ";
    expect(await (await request(env, "/auth/me", { token: SESSION_TOKEN })).json()).toMatchObject({ data: { is_admin: true } });
    for (const allowlist of [undefined, "", "   ", "bob@example.test"]) {
      env.ORIVANE_ADMIN_EMAILS = allowlist;
      expect(await (await request(env, "/auth/me", { token: SESSION_TOKEN })).json()).toMatchObject({ data: { is_admin: false } });
      expect((await request(env, "/admin/metrics", { token: SESSION_TOKEN, headers: { "is_admin": "true", "x-admin": "true", "x-role": "admin" } })).status).toBe(403);
    }
    env.ORIVANE_ADMIN_EMAILS = "alice@example.test";
    expect((await request(env, "/admin/metrics", { headers: { "is_admin": "true" } })).status).toBe(403);
  });

  it("retains session and optimizer authorization for forecast refresh", async () => {
    const { env } = fixture();
    env.ORIVANE_OPTIMIZER_TOKEN = "test-optimizer-token";
    expect((await request(env, "/forecast/run", { method: "POST", token: SESSION_TOKEN, body: {} })).status).toBe(422);
    expect((await request(env, "/forecast/run", { method: "POST", headers: { authorization: "Bearer test-optimizer-token" }, body: {} })).status).toBe(422);
    expect((await request(env, "/forecast/run", { method: "POST", headers: { authorization: "Bearer wrong-optimizer-token" }, body: {} })).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("runs and persists a forecast for an existing session using a local market-data fixture", async () => {
    const { env } = fixture();
    const timestamp = Array.from({ length: 100 }, (_, index) => Math.floor(Date.now() / 1000) - (100 - index) * 86400);
    const close = timestamp.map((_, index) => 100 + index * 0.15 + Math.sin(index / 4));
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (!String(input).startsWith("https://query1.finance.yahoo.com/v8/finance/chart/")) throw new Error("Unexpected fixture request");
      return new Response(JSON.stringify({ chart: { result: [{ timestamp, indicators: { quote: [{ close, open: close, high: close.map((price) => price + 1), low: close.map((price) => price - 1), volume: close.map(() => 10000) }], adjclose: [{ adjclose: close }] } }] } }));
    });
    const response = await request(env, "/forecast/run", { method: "POST", token: SESSION_TOKEN, body: { symbol: "SPY" } });
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { symbol: string } };
    expect(body.data.symbol).toBe("SPY");
    expect((env.ORIVANE_CLOUD_FORECASTS as TestKv).json("forecasts/v11/SPY.json")).toBeDefined();
    expect(fetch).toHaveBeenCalled();
  });
});

describe("generated Cloudflare API concurrent request isolation", () => {
  it("keeps a delayed edge-cache hit and its waitUntil metrics in the original env", async () => {
    const alice = fixture("alice", "alice@example.test");
    const bob = fixture("bob", "bob@example.test");
    let signalStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const resumed = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(Math.random).mockReturnValue(0);
    vi.stubGlobal("caches", {
      default: {
        match: vi.fn(async () => {
          signalStarted();
          await resumed;
          return new Response(JSON.stringify({ data: { cached: true } }), { headers: { "content-type": "application/json" } });
        }),
        put: vi.fn(),
      },
    });
    const aliceRequest = request(alice.env, "/home");
    await Promise.race([
      started,
      aliceRequest.then(() => { throw new Error("Request completed before reaching the edge cache."); }),
    ]);
    try {
      expect((await request(bob.env, "/auth/me", { token: SESSION_TOKEN })).status).toBe(200);
    } finally {
      release();
    }
    const response = await aliceRequest;
    expect(response.status).toBe(200);
    expect(response.headers.get("x-orivane-edge-cache")).toBe("HIT");
    expect(alice.metrics.values.size).toBe(1);
    expect(JSON.parse([...alice.metrics.values.values()][0])).toMatchObject({ cache: { "edge//api/home": { hit: 1 } } });
    expect(bob.metrics.values.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps identical tokens in different bindings tied to their own account and state", async () => {
    const alice = fixture("alice", "alice@example.test");
    const bob = fixture("bob", "bob@example.test");
    const pause = pauseFirstSessionRead(alice.users);
    const aliceRequest = request(alice.env, "/user/state", { method: "PATCH", token: SESSION_TOKEN, body: { patch: { research_reviews: { owner: "alice" } } } });
    await waitForPaused(pause, aliceRequest);
    let bobResponse: Response;
    try {
      bobResponse = await request(bob.env, "/user/state", { method: "PATCH", token: SESSION_TOKEN, body: { patch: { research_reviews: { owner: "bob" } } } });
    } finally {
      pause.release();
    }
    const aliceResponse = await aliceRequest;
    expect(aliceResponse.status).toBe(200);
    expect(bobResponse!.status).toBe(200);
    expect(alice.users.json(stateKey("alice"))).toMatchObject({ account_email: "alice@example.test", research_reviews: { owner: "alice" } });
    expect(bob.users.json(stateKey("bob"))).toMatchObject({ account_email: "bob@example.test", research_reviews: { owner: "bob" } });
    expect(alice.users.json(stateKey("bob"))).toBeUndefined();
    expect(bob.users.json(stateKey("alice"))).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps mail credentials and recipients scoped to a request paused in session lookup", async () => {
    const alice = fixture("alice", "alice@example.test");
    const bob = fixture("bob", "bob@example.test");
    alice.env.RESEND_API_KEY = "test-mail-alice";
    alice.env.ORIVANE_EMAIL_FROM = "alice-sender@app.example.test";
    bob.env.RESEND_API_KEY = "test-mail-bob";
    bob.env.ORIVANE_EMAIL_FROM = "bob-sender@app.example.test";
    vi.mocked(fetch).mockImplementation(async () => new Response("{}", { status: 200 }));
    const pause = pauseFirstSessionRead(alice.users);
    const aliceRequest = request(alice.env, "/alerts/test", { method: "POST", token: SESSION_TOKEN, body: { language: "en" } });
    await waitForPaused(pause, aliceRequest);
    let bobResponse: Response;
    try {
      bobResponse = await request(bob.env, "/alerts/test", { method: "POST", token: SESSION_TOKEN, body: { language: "en" } });
    } finally {
      pause.release();
    }
    expect((await aliceRequest).status).toBe(200);
    expect(bobResponse!.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    const deliveries = vi.mocked(fetch).mock.calls.map(([url, init]) => ({
      url,
      authorization: new Headers(init?.headers).get("authorization"),
      ...JSON.parse(String(init?.body)) as { to: string[]; from: string },
    }));
    expect(deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: "https://api.resend.com/emails", authorization: "Bearer test-mail-alice", to: ["alice@example.test"], from: "alice-sender@app.example.test" }),
      expect.objectContaining({ url: "https://api.resend.com/emails", authorization: "Bearer test-mail-bob", to: ["bob@example.test"], from: "bob-sender@app.example.test" }),
    ]));
  });

  it("does not replace a paused request's admin allowlist with another request's env", async () => {
    const alice = fixture("alice", "alice@example.test");
    const bob = fixture("bob", "bob@example.test");
    alice.env.ORIVANE_ADMIN_EMAILS = "alice@example.test";
    bob.env.ORIVANE_ADMIN_EMAILS = "bob@example.test";
    const pause = pauseFirstSessionRead(alice.users);
    const aliceRequest = request(alice.env, "/admin/metrics", { token: SESSION_TOKEN });
    await waitForPaused(pause, aliceRequest);
    try {
      expect((await request(bob.env, "/admin/metrics", { token: SESSION_TOKEN })).status).toBe(200);
    } finally {
      pause.release();
    }
    expect((await aliceRequest).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });
});
