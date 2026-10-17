"use client";
import { useEffect, useRef, useState } from "react";
import type { ResearchRecord, ResearchReviewEvent } from "@/lib/types";
import { captureResearchSnapshot } from "@/lib/research-record";
import { calendarDay, makeReviewEvent, recordTracking, validReviewDraft, type ReviewDraft } from "@/lib/research-record-review";
import { useApp } from "./providers";
import { useMyResearch } from "./use-my-research";
import { ResearchSnapshot } from "./research-snapshot";
import { useAuth } from "./auth-provider";
import { useResearchDraft, ResearchDraftStatus, DraftDiscardPrompt } from "./use-research-draft";
import { isReviewDraft, researchSaveLabel, type ReviewDraftEnvelope } from "@/lib/research-draft";
import s from "./research-records.module.css";

const direction = (value: string, zh: boolean) => ({ bullish: zh ? "看多" : "Bullish", bearish: zh ? "看空" : "Bearish", neutral: zh ? "中性" : "Neutral" })[value] || value;
const outcome = (value: string, zh: boolean) => ({ maintain: zh ? "维持判断" : "Maintain", adjust: zh ? "调整判断" : "Adjust", archive: zh ? "结束跟踪" : "End tracking" })[value] || value;

const dataLabel = (value: string, zh: boolean) => ({
  fresh: zh ? "已读取（非实时保证）" : "Read (not a real-time guarantee)", stale: zh ? "含超期数据" : "Expired data included",
  partial: zh ? "部分可用" : "Partially available", unavailable: zh ? "无可读取数据" : "No readable data",
  failed: zh ? "读取失败，可能保留旧值" : "Read failed; old values may remain", unchecked: zh ? "尚未读取" : "Not read", loading: zh ? "读取中" : "Reading",
})[value] || (zh ? "状态未知" : "Unknown status");

export function ResearchReviewButton({ record, compact = false, onSaved }: { record: ResearchRecord; compact?: boolean; onSaved?: (event: ResearchReviewEvent) => void }) {
  const { userState, language } = useApp(); const zh = language === "zh";
  const [open, setOpen] = useState(false), [saved, setSaved] = useState<ResearchReviewEvent | null>(null); const trigger = useRef<HTMLButtonElement>(null);
  const archived = recordTracking(record, userState).archived;
  return <span className={s.reviewAction}>
    {!archived && <button type="button" ref={trigger} onClick={() => { setSaved(null); setOpen(true); }} aria-label={`${zh ? "执行复核" : "Review"} ${record.symbol} ${record.id}`}>
      {zh ? "执行复核" : "Review"}{compact && <small> · {record.id.slice(0, 8)}</small>}
    </button>}
    {saved && !onSaved && <ReviewSavedNotice event={saved} />}
    {open && <ReviewEditor record={record} returnFocus={trigger.current} onClose={() => setOpen(false)} onSaved={event => { setOpen(false); setSaved(event); onSaved?.(event); }} />}
  </span>;
}

function ReviewEditor({ record, returnFocus, onClose, onSaved }: { record: ResearchRecord; returnFocus: HTMLElement | null; onClose: () => void; onSaved: (event: ResearchReviewEvent) => void }) {
  const { userState, language, saveResearchReview } = useApp(); const zh = language === "zh";
  const { entries, loading } = useMyResearch([record.symbol]); const entry = entries[record.symbol];
  const tracking = recordTracking(record, userState);

  const dialog = useRef<HTMLDialogElement>(null), locked = useRef(false), pending = useRef<ResearchReviewEvent | null>(null);
  const local = useResearchDraft<ReviewDraftEnvelope>(`review:${record.id}`, { fields: { outcome: "maintain", direction: tracking.direction, reason: "", risk_changes: "", next_review_date: null }, parentId: tracking.latest?.id || null, pending: null }, (value): value is ReviewDraftEnvelope => isReviewDraft(value) && (!value.pending || value.pending.record_id === record.id));
  const draft = local.value.fields;
  pending.current ||= local.value.pending;
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => { node?.close(); queueMicrotask(() => { if (returnFocus?.isConnected) returnFocus.focus(); else document.getElementById("research-actions-title")?.focus(); }); }; }, [returnFocus]);
  const set = <K extends keyof ReviewDraft>(key: K, value: ReviewDraft[K]) => { if (!pending.current) local.update({ ...local.current.current, fields: { ...local.current.current.fields, [key]: value } }); };
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (locked.current || local.loading) return;
    if (!validReviewDraft(draft)) { setError(zh ? "请填写复核理由、风险变化，下一次日期须晚于今天。" : "Enter reasoning and risk changes; the next date must be after today."); return; }
    locked.current = true; setSaving(true); setError("");
    try {
      if (!pending.current && (tracking.latest?.id || null) !== local.value.parentId) throw Error("Draft parent changed");
      pending.current ||= makeReviewEvent(record, userState, draft, entry);
      local.update({ ...local.value, pending: pending.current });
      if (await saveResearchReview(pending.current) !== "saved") throw Error("Unconfirmed");
      local.clear(); onSaved(pending.current);
    } catch { setError(zh ? "保存未确认。输入已保留，可重试同一次复核；若记录已有新的复核，请取消并放弃旧草稿后重新复核。" : "Save unconfirmed. Retry this same review; if the record changed, cancel and discard the old draft before reviewing again."); }
    finally { locked.current = false; setSaving(false); }
  }
  const original = record.initial_judgment || record;
  return <dialog ref={dialog} className={`${s.dialog} ${s.reviewDialog}`} aria-labelledby="review-title" onCancel={e => { e.preventDefault(); if (!saving) onClose(); }}>
    <header><div><h2 id="review-title">{zh ? "执行人工复核" : "Review your judgment"}</h2><p>{record.asset_name} · {record.symbol} · {record.id.slice(0, 8)}</p></div><button type="button" aria-label={zh ? "关闭复核" : "Close review"} disabled={saving || local.loading} onClick={onClose}>×</button></header>
    <section className={s.reviewContext}><h3>{zh ? (record.initial_judgment ? "原始判断" : "旧记录已有判断") : (record.initial_judgment ? "Original judgment" : "Available legacy judgment")} · {direction(original.direction, zh)}</h3>
      {!record.initial_judgment && <p className={s.note}>{zh ? "旧记录未保存初始版本；以下为已有判断，不能还原此前编辑。" : "Legacy record: this is the available judgment; earlier edits cannot be reconstructed."}</p>}
      <dl><div><dt>{zh ? "理由" : "Reason"}</dt><dd>{original.reason}</dd></div><div><dt>{zh ? "风险" : "Risks"}</dt><dd>{original.risks}</dd></div><div><dt>{zh ? "失效条件" : "Invalidation"}</dt><dd>{original.invalidation || (zh ? "未设置" : "Not set")}</dd></div></dl>
      <details><summary>{zh ? "首次保存快照" : "Original snapshot"}</summary><ResearchSnapshot record={record} zh={zh} /></details>
      <p className={s.note}>{zh ? "当前人工判断" : "Current personal view"}：{direction(tracking.direction, zh)}{tracking.latest ? ` · ${tracking.latest.reason}` : ""}</p>
    </section>
    <details className={s.reviewContext}><summary>{zh ? "当前可读取参考数据" : "Currently readable reference data"} · {dataLabel(loading ? "loading" : entry?.status || "unchecked", zh)}</summary>
      <p className={s.note}>{zh ? "市场时效待核验；仅读取已有数据，不生成预测。缺失或超期不妨碍人工复核。" : "Market freshness unverified. Reads existing data only; missing or expired data does not block a manual review."}</p>
      <p className={s.note}>{zh ? "读取状态" : "Read status"}：{dataLabel(loading ? "loading" : entry?.status || "unchecked", zh)}{entry?.checkedAt ? ` · ${zh ? "客户端接收" : "Client received"} ${new Date(entry.checkedAt).toLocaleString()}` : ""}</p>
      <ResearchSnapshot current record={{ ...record, snapshot: captureResearchSnapshot(record.symbol, entry?.history, entry?.forecast) }} zh={zh} />
    </details>
    <form onSubmit={submit}>
      <ResearchDraftStatus {...local} zh={zh} />
      <label>{zh ? "复核结论" : "Review outcome"}<select autoFocus aria-label={zh ? "复核结论" : "Review outcome"} disabled={saving || local.loading || !!pending.current} value={draft.outcome} onChange={e => { const value = e.target.value as ReviewDraft["outcome"]; local.update({ ...local.value, fields: { ...draft, outcome: value, next_review_date: value === "archive" ? null : draft.next_review_date } }); }}>
        {["maintain", "adjust", "archive"].map(value => <option value={value} key={value}>{outcome(value, zh)}</option>)}
      </select></label>
      {draft.outcome === "adjust" && <label>{zh ? "调整后的方向" : "Adjusted direction"}<select aria-label={zh ? "调整后的方向" : "Adjusted direction"} value={draft.direction} disabled={saving || local.loading || !!pending.current} onChange={e => set("direction", e.target.value as ReviewDraft["direction"])}>{["bullish", "bearish", "neutral"].map(value => <option value={value} key={value}>{direction(value, zh)}</option>)}</select></label>}
      <label>{zh ? "本次复核理由" : "Review reasoning"}<textarea aria-label={zh ? "本次复核理由" : "Review reasoning"} required maxLength={3000} rows={3} value={draft.reason} disabled={saving || local.loading || !!pending.current} onChange={e => set("reason", e.target.value)} /></label>
      <label>{zh ? "风险变化" : "Risk changes"}<textarea aria-label={zh ? "风险变化" : "Risk changes"} required maxLength={2000} rows={2} placeholder={zh ? "风险有何变化？无变化也请说明。" : "Describe changes, or explain why risks are unchanged."} value={draft.risk_changes} disabled={saving || local.loading || !!pending.current} onChange={e => set("risk_changes", e.target.value)} /></label>
      {draft.outcome !== "archive" && <label>{zh ? "下次复核日期（可选）" : "Next review date (optional)"}<input aria-label={zh ? "下次复核日期（可选）" : "Next review date (optional)"} type="date" min={calendarDay(new Date(Date.now() + 86400000))} value={draft.next_review_date || ""} disabled={saving || local.loading || !!pending.current} onChange={e => set("next_review_date", e.target.value || null)} /></label>}
      <p className={s.note}>{draft.outcome === "archive" ? (zh ? "归档后不再产生该记录的到期事项，历史保留；原有独立复核计划不变。" : "Archiving stops this record’s due tasks and retains history. Separate legacy plans remain unchanged.") : (zh ? "保存后结束本次复核；未设置下次日期则继续跟踪但不安排新的到期待办。按本机日期计算到期，不自动判断收益或准确率。" : "Saving completes this review. Without a next date, tracking continues without a new due task. Dates use this device’s calendar; no performance is inferred.")}</p>
      {error && <p role="alert" className={s.error}>{error}</p>}
      <DraftDiscardPrompt requested={local.discardRequested} onKeep={local.keep} onDiscard={() => local.discard(onClose)} zh={zh} />
      <footer><button type="button" disabled={saving || local.loading} onClick={() => local.cancel(onClose)}>{zh ? "取消" : "Cancel"}</button><button type="submit" className={s.primary} disabled={saving || local.loading}>{saving ? (zh ? "保存中…" : "Saving…") : (zh ? "保存本次复核" : "Save review")}</button></footer>
    </form>
  </dialog>;
}

export function ResearchReviewHistory({ record }: { record: ResearchRecord }) {
  const { userState, language } = useApp(); const zh = language === "zh";
  const { events } = recordTracking(record, userState);
  useEffect(() => {
    const reveal = () => {
      const event = events.find(item => window.location.hash === `#${reviewEventAnchor(item.id)}`);
      if (event) revealReviewEvent(event.id);
    };
    reveal(); window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [events.map(event => event.id).join(",")]);
  if (!events.length) return null;
  return <details className={s.reviewHistory}><summary>{zh ? `复核历史 · ${events.length} 次` : `Review history · ${events.length}`}</summary>
    {[...events].reverse().map(event => <section key={event.id} id={reviewEventAnchor(event.id)} tabIndex={-1}><h4>{outcome(event.outcome, zh)} · {direction(event.direction, zh)}</h4><p className={s.note}>{new Date(event.reviewed_at).toLocaleString(zh ? "zh-CN" : "en-US")} · {event.id.slice(0, 8)}</p><dl><div><dt>{zh ? "复核理由" : "Reason"}</dt><dd>{event.reason}</dd></div><div><dt>{zh ? "风险变化" : "Risk changes"}</dt><dd>{event.risk_changes}</dd></div><div><dt>{zh ? "安排的下次复核" : "Next review scheduled"}</dt><dd>{event.next_review_date || "—"}</dd></div></dl><details><summary>{zh ? "本次复核参考数据" : "Review reference data"}</summary><p className={s.note}>{zh ? "市场时效未核验；状态" : "Market freshness unverified; status"}：{dataLabel(event.data_status, zh)} · {zh ? "客户端接收" : "Client received"} {event.client_received_at || "—"}</p><ResearchSnapshot record={{ ...record, snapshot: event.current_snapshot }} zh={zh} /></details></section>)}
  </details>;
}

export function reviewEventAnchor(id: string) { return `research-review-${id}`; }
function revealReviewEvent(id: string) {
  const node = document.getElementById(reviewEventAnchor(id));
  const details = node?.closest("details");
  if (details) details.open = true;
  node?.scrollIntoView?.({ block: "center" }); node?.focus();
}
export function ReviewEventLink({ event }: { event: ResearchReviewEvent }) {
  const { language } = useApp();
  return <a href={`#${reviewEventAnchor(event.id)}`} onClick={() => revealReviewEvent(event.id)}>{language === "zh" ? "查看本次复核记录" : "View this review"}</a>;
}
export function ReviewSavedNotice({ event }: { event: ResearchReviewEvent }) {
  const { language } = useApp(); const { user } = useAuth(); const zh = language === "zh";
  return <span role="status" className={s.savedNotice}><strong>{zh ? "复核已保存" : "Review saved"}</strong> · {researchSaveLabel(zh, !!user)}{event.outcome === "archive" && <span>{zh ? " · 已停止跟踪，历史记录仍保留。" : " · Tracking stopped; history retained."}</span>} <ReviewEventLink event={event} /></span>;
}
