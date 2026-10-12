// @vitest-environment node
import { expect, it } from "vitest";
import { onRequest } from "../functions/api/[[path]]";
import { makeReviewEvent } from "../lib/research-record-review";
import { normalizeUserState } from "../lib/user-state";
import { makeResearchRecord } from "../lib/research-record";

it("round-trips a new record through the unchanged generated Worker user-state API without losing legacy reviews", async () => {
  const values = new Map<string, string>();
  const kv = {
    async get(key: string, options?: { type?: string } | string) { const value = values.get(key); return value === undefined ? null : options === "json" || typeof options === "object" && options.type === "json" ? JSON.parse(value) : value; },
    async put(key: string, value: unknown) { if (typeof value !== "string") throw Error("Expected string"); values.set(key, value); },
    async delete(key: string) { values.delete(key); },
    async list() { return { keys: [], list_complete: true }; },
  };
  const token = "00000000-0000-4000-8000-000000000011";
  values.set(`auth/sessions/${token}.json`, JSON.stringify({ token, user_id: "record-test", email: "record@example.test", expires_at: new Date(Date.now() + 60000).toISOString() }));
  values.set("auth/users/record%40example.test.json", JSON.stringify({ id: "record-test", email: "record@example.test" }));
  const reviews = { NVDA: { symbol: "NVDA", reason: "breakout", due_at: "2026-11-01", created_at: "2026-10-01" } };
  values.set("users/record-test.json", JSON.stringify({ research_reviews: reviews }));
  const record = makeResearchRecord({ symbol: "NVDA", name: "Nvidia", asset_type: "stock", data_source: "yahoo" }, { direction: "bullish", reason: "Demand", risks: "Valuation", review_date: null, invalidation: null });
  const request = async (method: string, body?: unknown) => {
    const promises: Promise<unknown>[] = [];
    const response = await onRequest({ request: new Request("https://preview.example.test/api/user/state", { method, headers: { cookie: `orivane_session=${token}`, "x-orivane-user-id": "record-test", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env: { ORIVANE_USER_STATE: kv }, waitUntil: p => { promises.push(p); } });
    await Promise.all(promises); return response;
  };
  expect((await request("PATCH", { patch: { research_records: { [record.id]: record } } })).status).toBe(200);
  const result = await (await request("GET")).json() as { data: Record<string, unknown> };
  expect(result.data.research_records).toEqual({ [record.id]: record });
  expect(result.data.research_reviews).toEqual(reviews);
  const event = makeReviewEvent(record, normalizeUserState({ research_records: { [record.id]: record } }), { outcome: "archive", direction: "bullish", reason: "Manual close", risk_changes: "No change", next_review_date: null });
  expect((await request("PATCH", { patch: { research_review_events: { [event.id]: event } } })).status).toBe(200);
  const restored = await (await request("GET")).json() as { data: Record<string, unknown> };
  expect(restored.data.research_review_events).toEqual({ [event.id]: event });
  expect(restored.data.research_records).toEqual(result.data.research_records);
  expect(restored.data.research_reviews).toEqual(reviews);
});
