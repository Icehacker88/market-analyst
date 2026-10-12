import { describe, expect, it } from "vitest";
import { appendReviewEvent, calendarDay, dueResearchRecords, makeReviewEvent, recordTracking, validReviewDraft } from "./research-record-review";
import { makeResearchRecord, upsertResearchRecord } from "./research-record";
import { applyUserStatePatch, normalizeUserState } from "./user-state";
import { buildResearchQueue } from "./my-research";
import type { Asset } from "./types";
const asset: Asset = { symbol: "NVDA", name: "Nvidia", asset_type: "stock", data_source: "yahoo" };
const draft = { direction: "bullish" as const, reason: "Original view", risks: "Risk", invalidation: "Orders fall", review_date: "2020-01-01" };
const review = { outcome: "maintain" as const, direction: "bullish" as const, reason: "Evidence unchanged", risk_changes: "Risk unchanged", next_review_date: null };
function initial() { const a = makeResearchRecord(asset, draft), b = makeResearchRecord(asset, { ...draft, reason: "Independent view" });return { a, b, state: normalizeUserState({ research_records: { [a.id]: a, [b.id]: b }, research_reviews: { NVDA: { symbol: "NVDA", reason: "breakout", due_at: "2020-01-01", created_at: "2019-01-01" } } }) }; }
describe("manual review events and due cycles", () => {
 it("keeps multiple record IDs as distinct tasks within one asset, including legacy plans", () => {
  const { state } = initial();const tasks = buildResearchQueue({ symbols: [], baseline: {}, entries: {}, records: state.research_records, reviews: state.research_reviews });
  expect(tasks).toHaveLength(1);expect(tasks[0].reasons).toHaveLength(3);expect(new Set(tasks[0].reasons.map(r => r.id)).size).toBe(3);
 });
 it("stores independent immutable history, changes current direction only, archives and retains all original fields", () => {
  const { a, state } = initial();const first = makeReviewEvent(a, state, { ...review, outcome: "adjust", direction: "bearish" });const next = appendReviewEvent(state, first);
  expect(next.research_records).toBe(state.research_records);expect(next.research_reviews).toBe(state.research_reviews);
  expect(recordTracking(a, next).direction).toBe("bearish");expect(dueResearchRecords(next).map(x => x.record.id)).not.toContain(a.id);
  const second = makeReviewEvent(a, next, { ...review, outcome: "archive" });const archived = appendReviewEvent(next, second);
  expect(recordTracking(a, archived)).toMatchObject({ archived: true, direction: "bearish" });expect(recordTracking(a, archived).events).toHaveLength(2);
  expect(archived.research_records![a.id]).toEqual(a);expect(() => makeReviewEvent(a, archived, review)).toThrow();
  expect(() => upsertResearchRecord(archived, { ...a, direction: "neutral" })).toThrow();
 });
 it("re-enters due cycle on the selected device calendar date, not UTC midnight", () => {
  const { a, state } = initial();const future = new Date();future.setFullYear(future.getFullYear() + 1);const date = calendarDay(future);
  const next = appendReviewEvent(state, makeReviewEvent(a, state, { ...review, next_review_date: date }));
  expect(dueResearchRecords(next).map(x => x.record.id)).not.toContain(a.id);
  expect(dueResearchRecords(next, new Date(future.getFullYear(), future.getMonth(), future.getDate(), 0, 1)).map(x => x.record.id)).toContain(a.id);
  expect(validReviewDraft({ ...review, next_review_date: calendarDay() })).toBe(false);
  expect(validReviewDraft({ ...review, next_review_date: "2030-02-30" })).toBe(false);
 });
 it("is idempotent on exact retries and rejects conflicting duplicate IDs or stale submissions", () => {
  const { a, state } = initial();const one = makeReviewEvent(a, state, review), two = makeReviewEvent(a, state, review);const next = appendReviewEvent(state, one);
  expect(appendReviewEvent(next, one)).toBe(next);expect(() => appendReviewEvent(next, two)).toThrow();expect(() => appendReviewEvent(next, { ...one, reason: "Changed" })).toThrow();
  const merged = applyUserStatePatch(next, { research_review_events: { [one.id]: { ...one, reason: "Overwrite" } } });expect(merged.research_review_events![one.id]).toEqual(one);
 });
 it("preserves old records without inventing initial versions and captures missing data explicitly", () => {
  const { a, state } = initial();delete a.initial_judgment;delete state.research_review_events;const saved = JSON.stringify(state);
  expect(dueResearchRecords(state)).toHaveLength(2);expect(JSON.stringify(state)).toBe(saved);
  const event = makeReviewEvent(a, state, review);expect(event.current_snapshot).toEqual({ reference_price: null, market_data_as_of: null, forecast: null });expect(event.client_received_at).toBeNull();
  const restored = normalizeUserState(JSON.parse(JSON.stringify(appendReviewEvent(state, event))));expect(recordTracking(a, restored).events).toEqual([event]);
 });
 it("retains the earliest saved judgment when a not-yet-reviewed record is edited", () => {
  const { a, state } = initial();const edited = upsertResearchRecord(state, { ...a, direction: "neutral", reason: "Edited" }).research_records![a.id];expect(edited.initial_judgment).toEqual(draft);expect(edited.snapshot).toEqual(a.snapshot);
 });
});
