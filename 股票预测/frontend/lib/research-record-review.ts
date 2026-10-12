import type { ResearchRecord, ResearchReviewEvent, UserState } from "./types";
import { captureResearchSnapshot, researchRecords } from "./research-record";
import type { ResearchDataEntry } from "./my-research-data";

export type ReviewDraft = Pick<ResearchReviewEvent, "outcome" | "direction" | "reason" | "risk_changes" | "next_review_date">;
export function calendarDay(now = new Date()) { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; }
export function validCalendarDay(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
export function reviewEvents(state: Pick<UserState, "research_review_events">, recordId: string): ResearchReviewEvent[] {
  return Object.values(state.research_review_events || {}).filter(e => e && e.version === 1 && e.id && e.record_id === recordId
    && Number.isFinite(Date.parse(e.reviewed_at)) && ["maintain", "adjust", "archive"].includes(e.outcome)
    && ["bullish", "bearish", "neutral"].includes(e.direction) && typeof e.reason === "string" && typeof e.risk_changes === "string")
    .sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at) || a.id.localeCompare(b.id));
}
export function recordTracking(record: ResearchRecord, state: Pick<UserState, "research_review_events">) {
  const events = reviewEvents(state, record.id), latest = events.at(-1);
  return { events, latest, archived: latest?.outcome === "archive", direction: latest?.direction || record.direction,
    dueDate: latest ? latest.next_review_date : record.review_date };
}
export function dueResearchRecords(state: UserState, now = new Date()) {
  const today = calendarDay(now);
  return researchRecords(state).flatMap(record => {
    const tracking = recordTracking(record, state);
    return !tracking.archived && tracking.dueDate && validCalendarDay(tracking.dueDate) && tracking.dueDate <= today ? [{ record, dueDate: tracking.dueDate }] : [];
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.record.id.localeCompare(b.record.id));
}
export function validReviewDraft(draft: ReviewDraft, now = new Date()) {
  return ["maintain", "adjust", "archive"].includes(draft.outcome) && ["bullish", "bearish", "neutral"].includes(draft.direction)
    && typeof draft.reason === "string" && !!draft.reason.trim() && draft.reason.length <= 3000
    && typeof draft.risk_changes === "string" && !!draft.risk_changes.trim() && draft.risk_changes.length <= 2000
    && (draft.next_review_date === null || (typeof draft.next_review_date === "string" && validCalendarDay(draft.next_review_date) && draft.next_review_date > calendarDay(now)))
    && (draft.outcome !== "archive" || draft.next_review_date === null);
}
export function makeReviewEvent(record: ResearchRecord, state: UserState, draft: ReviewDraft, entry?: ResearchDataEntry): ResearchReviewEvent {
  const tracking = recordTracking(record, state);
  if (tracking.archived || !validReviewDraft(draft)) throw new Error("Invalid review");
  const now = Date.now();
  return { ...draft, reason: draft.reason.trim(), risk_changes: draft.risk_changes.trim(),
    direction: draft.outcome === "adjust" ? draft.direction : tracking.direction,
    version: 1, id: crypto.randomUUID(), record_id: record.id, parent_event_id: tracking.latest?.id || null,
    // Monotonic within the locally known chain, including rapid successive reviews.
    reviewed_at: new Date(Math.max(now, (Date.parse(tracking.latest?.reviewed_at || "") || 0) + 1)).toISOString(),
    current_snapshot: captureResearchSnapshot(record.symbol, entry?.history, entry?.forecast),
    data_status: entry?.status || "unchecked", client_received_at: entry?.checkedAt ? new Date(entry.checkedAt).toISOString() : null };
}
export function appendReviewEvent(state: UserState, event: ResearchReviewEvent): UserState {
  const existing = state.research_review_events?.[event.id];
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(event)) throw new Error("Review ID conflict");
    return state;
  }
  const record = researchRecords(state).find(r => r.id === event.record_id);
  if (!record || event.version !== 1 || !event.id || !event.current_snapshot || !Number.isFinite(Date.parse(event.reviewed_at)) || !validReviewDraft(event, new Date(event.reviewed_at))) throw new Error("Invalid review event");
  const tracking = recordTracking(record, state);
  if (tracking.archived || (tracking.latest?.id || null) !== event.parent_event_id) throw new Error("Review changed; reopen it");
  if (event.outcome !== "adjust" && event.direction !== tracking.direction) throw new Error("Direction must be maintained");
  const events = { ...state.research_review_events, [event.id]: event };
  if (JSON.stringify({ research_records: state.research_records, research_review_events: events }).length > 240000) throw new Error("Research storage limit reached");
  return { ...state, research_review_events: events };
}
