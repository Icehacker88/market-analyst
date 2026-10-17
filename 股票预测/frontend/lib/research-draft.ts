import type { ResearchDraft } from "./research-record";
import type { ReviewDraft } from "./research-record-review";
import type { ResearchRecord, ResearchReviewEvent } from "./types";

export type RecordDraftEnvelope = { fields: ResearchDraft; pending: ResearchRecord | null };
export type ReviewDraftEnvelope = { fields: ReviewDraft; parentId: string | null; pending: ResearchReviewEvent | null };
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown, max: number) => typeof x === "string" && x.length <= max;
const optional = (x: unknown, max: number) => x === null || text(x, max);
const direction = (x: unknown) => ["bullish", "bearish", "neutral"].includes(String(x));
export function isRecordDraft(value: unknown): value is RecordDraftEnvelope {
  if (!obj(value) || !obj(value.fields)) return false;
  const f = value.fields;
  return direction(f.direction) && text(f.reason, 3000) && text(f.risks, 2000) && optional(f.invalidation, 1000) && optional(f.review_date, 10)
    && (value.pending === null || (obj(value.pending) && value.pending.version === 1 && text(value.pending.id, 100) && text(value.pending.symbol, 100) && obj(value.pending.snapshot)));
}
export function isReviewDraft(value: unknown): value is ReviewDraftEnvelope {
  if (!obj(value) || !obj(value.fields)) return false;
  const f = value.fields;
  return ["maintain", "adjust", "archive"].includes(String(f.outcome)) && direction(f.direction) && text(f.reason, 3000) && text(f.risk_changes, 2000) && optional(f.next_review_date, 10) && optional(value.parentId, 100)
    && (value.pending === null || (obj(value.pending) && value.pending.version === 1 && text(value.pending.id, 100) && text(value.pending.record_id, 100) && value.pending.parent_event_id === value.parentId && obj(value.pending.current_snapshot)));
}
export function researchSaveLabel(zh: boolean, signedIn: boolean) {
  return signedIn ? (zh ? "已保存到本机，云端同步待确认" : "Saved on this device; cloud sync awaits confirmation") : (zh ? "仅保存在此设备" : "Saved only on this device");
}
