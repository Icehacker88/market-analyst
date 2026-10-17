// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { createHash, pbkdf2Sync } from "node:crypto";
import { fileURLToPath } from "node:url";

const email = "synthetic@example.test", password = "synthetic password only";
const accountKey = (value = email) => `auth/users/${encodeURIComponent(value)}.json`;
let worker: Miniflare;
type LocalKv = { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void>; delete(key: string): Promise<void>; list(options?: {prefix?: string}): Promise<{keys: Array<{name: string}>}> };
let users: LocalKv;
let challengeCalls = 0;
const usedTokens = new Set<string>();
let challengeFailure = false;
const credentials = (overrides = {}) => ({ email, password, challengeToken: `login:${crypto.randomUUID()}`, ...overrides });
async function post(path: string, data?: unknown, headers: Record<string, string> = {}) {
  return worker.dispatchFetch(`https://test/api/auth/${path}`, { method: "POST", headers: { origin: "https://test", "content-type": "application/json", ...headers }, body: JSON.stringify(data ?? {}) });
}
async function seed(value: Record<string, unknown>) {
  await users.put(accountKey(), JSON.stringify({ id: "original-id", email, name: "Synthetic", created_at: "2020-01-01T00:00:00Z", ...value }));
}
const cookie = (response: {headers: {get(name: string): string | null}}) => response.headers.get("set-cookie")!.split(";")[0];
const state = { research_records: { kept: { id: "kept", snapshot: null } }, research_review_events: { event: { id: "event" } }, research_reviews: { plan: { due_date: "2030-01-01" } } };

beforeAll(async () => {
  const result = await build({ stdin: { contents: `import {onRequest} from "./functions/api/[[path]].ts";
      export default {fetch(r,e,c){
        e = {...e};
        if(r.headers.get('x-test-disabled')) e.ORIVANE_PASSWORD_AUTH_ENABLED = 'false';
        if(r.headers.get('x-test-signup-disabled')) e.ORIVANE_PASSWORD_SIGNUP_ENABLED = 'false';
        const fail = r.headers.get('x-test-store-failure');
        if(fail) e.ORIVANE_USER_STATE = new Proxy(e.ORIVANE_USER_STATE, {get(target,key){
          if(key === fail) return () => {throw new Error('SENSITIVE STORAGE DETAIL MUST NOT ESCAPE');};
          if(key === 'put' && fail === 'put-account') return (name,value,opts) => {if(name.startsWith('auth/users/')) throw new Error('SENSITIVE STORAGE DETAIL MUST NOT ESCAPE');return target.put(name,value,opts);};
          const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
        }});
        return onRequest({request:r,env:e,waitUntil:c.waitUntil.bind(c)});
      }}`, resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
  worker = new Miniflare({ modules: true, script: result.outputFiles[0].text, compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"],
    kvNamespaces: ["ORIVANE_USER_STATE", "ORIVANE_API_CACHE", "ORIVANE_API_METRICS", "ORIVANE_AI_USAGE", "ORIVANE_CLOUD_FORECASTS", "ORIVANE_ASSET_LOGOS"],
    bindings: { ORIVANE_ADMIN_EMAILS: "admin@example.test", ORIVANE_PASSWORD_AUTH_ENABLED: "true", ORIVANE_PASSWORD_SIGNUP_ENABLED: "true", ORIVANE_TURNSTILE_SITE_KEY: "synthetic-site", ORIVANE_TURNSTILE_SECRET_KEY: "synthetic-secret" },
    outboundService: async (request) => {
      if (request.url !== "https://challenges.cloudflare.com/turnstile/v0/siteverify") throw new Error("Unexpected network");
      challengeCalls++;
      if (challengeFailure) return new Response("Unavailable", { status: 503 });
      const body = await request.json() as { response: string };
      const token = body.response;
      const success = !usedTokens.has(token) && !token.startsWith("invalid:");
      usedTokens.add(token);
      return Response.json({ success, hostname: token.startsWith("host:") ? "other.test" : "test", action: token.split(":")[0] });
    },
  });
  users = await worker.getKVNamespace("ORIVANE_USER_STATE") as unknown as LocalKv;
}, 20000);

beforeEach(async () => {
  for (const { name } of (await users.list()).keys) await users.delete(name);
  usedTokens.clear(); challengeCalls = 0; challengeFailure = false;
});
afterAll(async () => { await worker?.dispose(); });

describe("password auth in actual local workerd", () => {
  it("registers, verifies the current scheme, restores and revokes the unchanged KV session", async () => {
    const signup = await post("signup", credentials({ challengeToken: "signup:new" }));
    expect(signup.status).toBe(200);
    const body = await signup.json() as {data: {user: {id: string}}};
    const raw = JSON.parse((await users.get(accountKey()))!);
    expect(raw.password_credential).toMatchObject({ scheme: "pbkdf2-sha256", version: 1, iterations: 600000, dklen: 32 });
    expect(raw.password_credential.hash === pbkdf2Sync(password, Buffer.from(raw.password_credential.salt, "base64"), 600000, 32, "sha256").toString("base64")).toBe(true);
    expect(raw.confirmedAt).toBeUndefined();
    expect(body.data).not.toHaveProperty("token");
    expect(body.data.user).not.toHaveProperty("password_credential");
    expect(signup.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax");
    await users.put(`users/${body.data.user.id}.json`, JSON.stringify(state));
    const login = await post("login", credentials()); expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ data: { user: { id: body.data.user.id } } });
    expect(await (await worker.dispatchFetch("https://test/api/auth/me", {headers:{cookie:cookie(login)}})).json()).toMatchObject({data:{id:body.data.user.id}});
    expect((await post("logout", {}, {cookie:cookie(login)})).status).toBe(200);
    expect(await (await worker.dispatchFetch("https://test/api/auth/me", {headers:{cookie:cookie(login)}})).json()).toEqual({data:null});
    expect(JSON.parse((await users.get(`users/${body.data.user.id}.json`))!)).toEqual(state);
  }, 15000);

  it.each(["sha256", "pbkdf2-210000", "pbkdf2-600000", "pbkdf2-1000000"])("upgrades %s only after exact legacy verification, preserving UUID/state/existing sessions", async format => {
    const salt = "legacy-salt", iterations = format === "sha256" ? 600000 : Number(format.split("-")[1]);
    const hash = format === "sha256" ? createHash("sha256").update(`${salt}:${password}`).digest("base64") : `pbkdf2_sha256$${iterations}$${salt}$${pbkdf2Sync(password,salt,iterations,32,"sha256").toString("base64")}`;
    await seed({ salt, password_hash: hash });
    await users.put("users/original-id.json", JSON.stringify(state));
    await users.put("auth/sessions/old-session.json", JSON.stringify({token:"old-session",user_id:"original-id",email,expires_at:new Date(Date.now()+60000).toISOString()}));
    const before = await users.get(accountKey());
    const bad = await post("login", credentials({password:"wrong-password"})); expect(bad.status).toBe(401);
    expect(await users.get(accountKey())).toBe(before);
    const good = await post("login", credentials()); expect(good.status).toBe(200);
    expect(await good.json()).toMatchObject({data:{user:{id:"original-id"}}});
    const upgraded = JSON.parse((await users.get(accountKey()))!);
    expect(upgraded).toMatchObject({id:"original-id",created_at:"2020-01-01T00:00:00Z",salt:"",password_hash:"",password_credential:{version:1,iterations:Math.max(600000,iterations)}});
    expect(JSON.parse((await users.get("users/original-id.json"))!)).toEqual(state);
    expect(await(await worker.dispatchFetch("https://test/api/auth/me",{headers:{cookie:"orivane_session=old-session"}})).json()).toMatchObject({data:{id:"original-id"}});
  },15000);

  it.each([
    {salt:"legacy",password_hash:""},
    {salt:"legacy"},
    {salt:"legacy",password_hash:"unknown$1$abc"},
    {salt:"legacy",password_hash:"pbkdf2_sha256$210000$legacy$broken"},
    {salt:"legacy",password_hash:"pbkdf2_sha256$0$legacy$" + "A".repeat(43) + "="},
    {salt:"legacy",password_hash:"pbkdf2_sha256$210000$other$" + "A".repeat(43) + "="},
    {salt:"legacy",password_hash:"pbkdf2_sha256$9999999$legacy$" + "A".repeat(43) + "="},
    {salt:"legacy",password_hash:createHash("sha256").update(`legacy:${password}`).digest("base64"),password_credential:{scheme:"pbkdf2-sha256",version:2}},
    {salt:"legacy",password_credential:{scheme:"pbkdf2-sha256",version:1,iterations:210000,dklen:32,salt:"AAAAAAAAAAAAAAAAAAAAAA==",hash:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}},
    {salt:"legacy",password_credential:{scheme:"other",version:1,iterations:600000,dklen:32}},
    {salt:"legacy",password_credential:null},
  ])("rejects malformed/unknown credentials without fallback or writes %#",async record=>{
    await seed(record); const before = await users.get(accountKey());
    const response=await post("login",credentials()); expect(response.status).toBe(401);
    expect(await response.json()).toEqual({error:{code:"invalid_login",message:"Email or password is incorrect."}});
    expect(await users.get(accountKey())).toBe(before);
    expect((await users.list({prefix:"auth/sessions/"})).keys).toHaveLength(0);
  },10000);

  it("never verifies a historical PBKDF2 hash at a substituted iteration count",async()=>{
    const salt="legacy";
    await seed({salt,password_hash:`pbkdf2_sha256$600000$${salt}$${pbkdf2Sync(password,salt,210000,32,"sha256").toString("base64")}`});
    expect((await post("login",credentials())).status).toBe(401);
  });

  it("rejects duplicate registration without overwriting the original account",async()=>{
    await seed({salt:"legacy",password_hash:""});const before=await users.get(accountKey());
    const response=await post("signup",credentials({challengeToken:"signup:duplicate"}));
    expect(response.status).toBe(400);expect(await users.get(accountKey())).toBe(before);
    expect(await response.text()).not.toContain("exists");
  });
  it("does not allow self-registration to claim an administrator email",async()=>{
    const response=await post("signup",credentials({email:"admin@example.test",challengeToken:"signup:admin"}));
    expect(response.status).toBe(400);
    expect(await users.get(accountKey("admin@example.test"))).toBeNull();
    expect((await users.list({prefix:"auth/sessions/"})).keys).toHaveLength(0);
  });
  it("returns the same login error for an unknown account",async()=>{
    const response=await post("login",credentials());expect(response.status).toBe(401);
    expect(await response.json()).toEqual({error:{code:"invalid_login",message:"Email or password is incorrect."}});
  });
  it("fails closed when registration/auth are disabled, without any KDF/challenge/account writes",async()=>{
    expect((await post("signup",credentials(),{"x-test-disabled":"1"})).status).toBe(503);
    expect((await post("signup",credentials(),{"x-test-signup-disabled":"1"})).status).toBe(403);
    expect(challengeCalls).toBe(0);expect(await users.get(accountKey())).toBeNull();
  });
  it("rejects cross-origin, oversized, malformed and weak requests before challenge/KDF",async()=>{
    expect((await post("login",credentials(),{origin:"https://evil.test"})).status).toBe(403);
    expect((await post("logout",{}, {origin:"https://evil.test"})).status).toBe(403);
    expect((await post("signup",credentials({password:"short"}))).status).toBe(422);
    expect((await post("login",credentials({password:"x".repeat(20000)}))).status).toBe(422);
    expect((await post("login",credentials({password:{x:1}}))).status).toBe(422);
    expect(challengeCalls).toBe(0);
  });
  it("rejects missing, reused, wrong-action and wrong-host challenges",async()=>{
    for(const challengeToken of ["", "invalid:1", "signup:wrong-action", "host:other"])
      expect((await post("login",credentials({challengeToken}))).status).toBe(403);
    expect((await post("login",credentials({challengeToken:"login:once"}))).status).toBe(401);
    expect((await post("login",credentials({challengeToken:"login:once"}))).status).toBe(403);
  });
  it("limits attempts even with new challenge tokens, without exposing the email in the KV key",async()=>{
    const digest=createHash("sha256").update(email).digest("hex");
    await users.put(`auth/attempts/${digest}.json`,JSON.stringify({count:10,expires_at:Date.now()+900000}));
    const response=await post("login",credentials());expect(response.status).toBe(429);expect(response.headers.get("retry-after")).toBe("900");
  });
  it("allows attempts after the throttle window expires",async()=>{
    const digest=createHash("sha256").update(email).digest("hex");
    await users.put(`auth/attempts/${digest}.json`,JSON.stringify({count:10,expires_at:Date.now()-1000}));
    expect((await post("login",credentials())).status).toBe(401);
  });
  it.each(["get","put"])("fails closed and redacts %s storage errors",async failure=>{
    const response=await post("login",credentials(),{"x-test-store-failure":failure});
    expect(response.status).toBe(503);expect(await response.text()).not.toContain("SENSITIVE");
    expect((await users.list({prefix:"auth/sessions/"})).keys).toHaveLength(0);
  });
  it("retains the legacy record and issues no session when upgrade storage fails",async()=>{
    await seed({salt:"legacy",password_hash:createHash("sha256").update(`legacy:${password}`).digest("base64")});
    const before=await users.get(accountKey());
    const response=await post("login",credentials(),{"x-test-store-failure":"put-account"});
    expect(response.status).toBe(503);expect(await users.get(accountKey()) === before).toBe(true);
    expect((await users.list({prefix:"auth/sessions/"})).keys).toHaveLength(0);
    expect((await post("login",credentials())).status).toBe(200);
  });
  it("supports old passwords shorter than the new registration minimum",async()=>{
    const oldPassword="old-pass";
    await seed({salt:"legacy",password_hash:createHash("sha256").update(`legacy:${oldPassword}`).digest("base64")});
    expect((await post("login",credentials({password:oldPassword}))).status).toBe(200);
  });
  it("does not falsely confirm logout when session revocation fails",async()=>{
    const response=await post("logout",{}, {cookie:"orivane_session=synthetic", "x-test-store-failure":"delete"});
    expect(response.status).toBe(503);expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).not.toContain("SENSITIVE");
  });
  it("fails closed on the challenge provider's outage",async()=>{
    challengeFailure=true;expect((await post("login",credentials())).status).toBe(503);
    expect((await users.list()).keys).toHaveLength(0);
  });
});
