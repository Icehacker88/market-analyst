// @vitest-environment node

import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Exercise the generated Pages entry point inside workerd with local KV bindings.
// Network and production credentials are deliberately absent from this harness.
let worker: Miniflare;
type LocalKv = {
  list(): Promise<{ keys: Array<{ name: string }> }>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};
let users: LocalKv;
const accountKey = (id: string) => `auth/users/${encodeURIComponent(`${id}@example.test`)}.json`;
const sessionKey = (id: string) => `auth/sessions/${id}-session.json`;
const cookie = (id: string) => ({ cookie: `orivane_session=${id}-session` });

beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: 'import { onRequest } from "./functions/api/[[path]].ts"; export default { fetch(request, env, ctx) { return onRequest({ request, env, waitUntil: ctx.waitUntil.bind(ctx) }); } };',
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      loader: "ts",
    },
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
  });
  worker = new Miniflare({
    modules: true,
    script: result.outputFiles[0].text,
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    kvNamespaces: ["ORIVANE_USER_STATE", "ORIVANE_API_CACHE", "ORIVANE_API_METRICS", "ORIVANE_AI_USAGE", "ORIVANE_CLOUD_FORECASTS", "ORIVANE_ASSET_LOGOS"],
    bindings: { ORIVANE_ADMIN_EMAILS: "alice@example.test" },
    outboundService: () => new Response("External network disabled in security tests", { status: 503 }),
  });
  users = await worker.getKVNamespace("ORIVANE_USER_STATE") as unknown as LocalKv;
}, 20_000);

beforeEach(async () => {
  const keys = await users.list();
  await Promise.all(keys.keys.map(({ name }) => users.delete(name)));
  for (const id of ["alice", "bob"]) {
    await users.put(accountKey(id), JSON.stringify({ id, email: `${id}@example.test`, name: id }));
    await users.put(sessionKey(id), JSON.stringify({ token: `${id}-session`, user_id: id, email: `${id}@example.test`, expires_at: new Date(Date.now() + 3_600_000).toISOString() }));
    await users.put(`users/${id}.json`, JSON.stringify({ account_email: `${id}@example.test`, watchlists: [{ id: "default", name: id, symbols: [] }] }));
  }
});

afterAll(async () => { await worker?.dispose(); });

describe("local Cloudflare workerd runtime", () => {
  it("rejects unauthenticated and forged Bearer requests", async () => {
    const forged = `unsigned.${Buffer.from(JSON.stringify({ sub: "alice", email: "alice@example.test" })).toString("base64url")}.fake`;
    const me = await worker.dispatchFetch("https://test/api/auth/me", { headers: { authorization: `Bearer ${forged}` } });
    expect(await me.json()).toEqual({ data: null });
    expect((await worker.dispatchFetch("https://test/api/user/state")).status).toBe(401);
  });

  it.each(["expired", "wrong-id", "wrong-email"])("rejects %s sessions in actual Worker KV", async (invalid) => {
    const session = JSON.parse((await users.get(sessionKey("alice")))!);
    if (invalid === "expired") session.expires_at = "2000-01-01T00:00:00.000Z";
    if (invalid === "wrong-id") session.user_id = "bob";
    if (invalid === "wrong-email") await users.put(accountKey("alice"), JSON.stringify({ id: "alice", email: "bob@example.test" }));
    await users.put(sessionKey("alice"), JSON.stringify(session));
    expect((await worker.dispatchFetch("https://test/api/user/state", { headers: cookie("alice") })).status).toBe(401);
  });

  it("keeps concurrent cookie sessions and private writes separate", async () => {
    const responses = await Promise.all(["alice", "bob"].map((id) => worker.dispatchFetch("https://test/api/user/state", {
      method: "PATCH",
      headers: { ...cookie(id), "content-type": "application/json", "x-orivane-user-id": id },
      body: JSON.stringify({ patch: { watchlists: [{ id: "default", name: `${id}-saved`, symbols: [] }] } }),
    })));
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    for (const id of ["alice", "bob"]) {
      const state = JSON.parse((await users.get(`users/${id}.json`))!);
      expect(state).toMatchObject({ account_email: `${id}@example.test`, watchlists: [{ name: `${id}-saved` }] });
      const me = await worker.dispatchFetch("https://test/api/auth/me", { headers: cookie(id) });
      expect(await me.json()).toMatchObject({ data: { id } });
    }
  });

  it("rejects an old account's patch after its browser cookie changes", async () => {
    const before = await users.get("users/bob.json");
    const response = await worker.dispatchFetch("https://test/api/user/state", {
      method: "PATCH", headers: { ...cookie("bob"), "content-type": "application/json", "x-orivane-user-id": "alice" },
      body: JSON.stringify({ patch: { watchlists: [] } }),
    });
    expect(response.status).toBe(403);
    expect(await users.get("users/bob.json")).toBe(before);
  });
});
