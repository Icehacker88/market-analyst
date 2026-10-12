import { describe, expect, it } from "vitest";
import { captureResearchSnapshot, makeResearchRecord, upsertResearchRecord, validResearchDraft } from "./research-record";
import { normalizeUserState, statePatch, applyUserStatePatch } from "./user-state";
import type { Asset, Forecast, History } from "./types";
const asset = { symbol: "NVDA", name: "Nvidia", asset_type: "stock", data_source: "yahoo", currency: "USD" } as Asset;
const draft = { direction: "bullish" as const, reason: "Demand", risks: "Valuation", invalidation: null, review_date: "2026-11-01" };
const history = { symbol: "NVDA", snapshot: { latest_price: 120 }, data_as_of: "2026-10-09" } as unknown as History;
const forecast = { symbol: "NVDA", signal: "Up", best_model: "ensemble", generated_at: "2026-10-09T22:00:00Z", data_as_of: "2026-10-09", forecast_1d_return: 0, forecast_5d_return: 2, forecast_1m_return: 4, self_optimization: { version: "opt-v1" } } as Forecast;

describe("research record snapshot and state compatibility", () => {
  it("captures available evidence without inventing model version, and preserves zero", () => {
    expect(captureResearchSnapshot(asset.symbol, history, forecast)).toMatchObject({ reference_price: 120, market_data_as_of: "2026-10-09", forecast: { return_1d: 0, model: "ensemble", model_version: null, optimization_version: "opt-v1" } });
  });
  it("records missing or mismatched asset data explicitly as unavailable", () => {
    expect(captureResearchSnapshot("MSFT", history, forecast)).toEqual({ reference_price: null, market_data_as_of: null, forecast: null });
    expect(makeResearchRecord(asset, draft).snapshot.forecast).toBeNull();
  });
  it("edits judgment under a stable ID without recapturing history or touching review plans", () => {
    const original = makeResearchRecord(asset, draft, history, forecast);
    const before = normalizeUserState({ research_reviews: { NVDA: { symbol: "NVDA", reason: "pullback", due_at: "2026-11-01", created_at: "2026-10-09" } } });
    const saved = upsertResearchRecord(before, original);
    const edited = upsertResearchRecord(saved, { ...original, reason: "Revised view", snapshot: { reference_price: 999, market_data_as_of: "2099-01-01", forecast: null } });
    expect(Object.keys(edited.research_records!)).toEqual([original.id]);
    expect(edited.research_records![original.id]).toMatchObject({ reason: "Revised view", created_at: original.created_at, snapshot: original.snapshot });
    expect(edited.research_reviews).toBe(before.research_reviews);
    const patch = statePatch(saved, edited);
    expect(Object.keys(patch)).toEqual(["research_records"]);
    expect(applyUserStatePatch(saved, patch)).toEqual(edited);
  });
  it("supports legacy state and rejects invalid input or excessive payload", () => {
    expect(normalizeUserState({ research_reviews: {} }).research_records).toEqual({});
    expect(validResearchDraft({ ...draft, reason: " " })).toBe(false);
    expect(validResearchDraft({ ...draft, review_date: "2026-02-30" })).toBe(false);
    const record = makeResearchRecord(asset, draft);const records = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [String(i), { ...record, id: String(i), reason: "x".repeat(3000) }]));
    expect(() => upsertResearchRecord(normalizeUserState({ research_records: records }), record)).toThrow("limit");
  });
});
