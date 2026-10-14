"use client";

import { useEffect, useRef, useState } from "react";
import { NotebookPen, ArrowRight, X } from "lucide-react";
import { assetPath } from "@/lib/asset-catalog";
import { displayAssetName } from "@/lib/assets";
import { ResearchSnapshot as Snapshot } from "./research-snapshot";
import { ResearchReviewButton, ResearchReviewHistory } from "./research-review";
import { recordTracking } from "@/lib/research-record-review";
import { makeResearchRecord, researchRecords, validResearchDraft, type ResearchDraft } from "@/lib/research-record";
import type { Asset, Forecast, History, ResearchRecord } from "@/lib/types";
import { AppLink as Link } from "./app-link";
import { useApp } from "./providers";
import { useAuth } from "./auth-provider";
import { useResearchDraft, ResearchDraftStatus, DraftDiscardPrompt } from "./use-research-draft";
import { isRecordDraft, researchSaveLabel, type RecordDraftEnvelope } from "@/lib/research-draft";
import s from "./research-records.module.css";

const directions = { bullish: ["看多", "Bullish"], bearish: ["看空", "Bearish"], neutral: ["中性", "Neutral"] };

const date = (value: string, zh: boolean) => new Date(value).toLocaleString(zh ? "zh-CN" : "en-US");

export function SingleAssetResearchEntry({ symbols, assets, active, history, forecast }: { symbols: string[]; assets: Asset[]; active: string; history?: History; forecast?: Forecast }) {
  const asset = assets.length === 1 && symbols.length === 1 && active === symbols[0] ? assets.find(item => item.symbol === active && item.name?.trim()) : undefined;
  return asset ? <ResearchRecordEntry key={asset.symbol} asset={asset} history={history} forecast={forecast} /> : null;
}

export function ResearchRecordEntry({ asset, history, forecast }: { asset: Asset; history?: History; forecast?: Forecast }) {
  const { user } = useAuth();
  const { language } = useApp(); const zh = language === "zh";
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false); const [message, setMessage] = useState("");
  return <section className={s.entry} aria-label={zh ? "个人研究判断" : "Personal research judgment"}>
    <div><strong>{zh ? "记录你的研究判断" : "Record your research judgment"}</strong><p>{zh ? "留下方向、理由与风险；没有行情也可以记录。" : "Save your view, reasoning and risks, even without market data."}</p></div>
    <button ref={trigger} type="button" onClick={() => { setMessage(""); setOpen(true); }}><NotebookPen size={16} />{zh ? "保存研究判断" : "Save research judgment"}</button>
    {message && <p role="status">{message} <Link href="/favorites/#research-records">{zh ? "查看我的研究记录" : "View my records"}</Link></p>}
    {open && <ResearchRecordEditor returnFocus={trigger.current} asset={asset} history={history} forecast={forecast} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); setMessage(researchSaveLabel(zh, !!user)); }} />}
  </section>;
}

export function ResearchRecords() {
  const { user } = useAuth();
  const { userState, language } = useApp(); const zh = language === "zh";
  const focusTarget = useRef<HTMLButtonElement | null>(null);
  const records = researchRecords(userState); const [editing, setEditing] = useState<ResearchRecord | null>(null); const [message, setMessage] = useState("");
  return <section className={s.section} id="research-records">
    <header><div><h2>{zh ? "我的研究记录" : "My research records"}</h2><p>{zh ? "你的个人判断与首次保存时的参考快照。编辑不会改写原始快照。" : "Your judgments with the original reference snapshot, preserved when editing."}</p></div><span>{records.length} {zh ? "条" : "records"}</span></header>
    {message && <p role="status">{message}</p>}
    {!records.length ? <div className={s.empty}>{zh ? "还没有研究记录。在资产详情页选择「保存研究判断」，无需先关注资产。" : "No research records yet. Choose Save research judgment on an asset page; following it is optional."}<Link href="/stocks/">{zh ? "查找资产" : "Find an asset"}<ArrowRight size={14} /></Link></div> : <div className={s.list}>{records.map(record => { const tracking = recordTracking(record, userState); return <article className={s.record} key={record.id}>
      <header><strong>{record.asset_name} <small>{record.symbol}</small></strong><div className={s.badges}><span>{directions[tracking.direction][zh ? 0 : 1]}</span>{tracking.archived && <span>{zh ? "已归档" : "Archived"}</span>}</div></header>
      <p className={s.note}>{tracking.archived ? (zh ? "已停止跟踪，历史记录仍保留。" : "Tracking stopped; history retained.") : tracking.dueDate ? `${zh ? "下次复核" : "Next review"} ${tracking.dueDate}` : (zh ? "继续跟踪 · 未设置下次复核日期" : "Tracking · No next review date")}</p>
      <p className={s.dates}>{zh ? "创建" : "Created"} {date(record.created_at, zh)}{tracking.latest ? ` · ${zh ? "最近复核" : "Last reviewed"} ${date(tracking.latest.reviewed_at, zh)}` : ` · ${zh ? "编辑" : "Edited"} ${date(record.updated_at, zh)}`}</p>
      {tracking.latest ? <dl aria-label={zh ? "当前判断" : "Current judgment"}><div><dt>{zh ? "当前判断说明 · 最近复核" : "Current reasoning · Latest review"}</dt><dd>{tracking.latest.reason}</dd></div><div><dt>{zh ? "最近复核的风险变化" : "Latest risk changes"}</dt><dd>{tracking.latest.risk_changes}</dd></div></dl> : <dl><div><dt>{zh ? "判断理由" : "Reasoning"}</dt><dd>{record.reason}</dd></div><div><dt>{zh ? "主要风险" : "Main risks"}</dt><dd>{record.risks}</dd></div><div><dt>{zh ? "失效条件" : "Invalidation condition"}</dt><dd>{record.invalidation || (zh ? "未设置" : "Not set")}</dd></div></dl>}
      <details><summary>{zh ? "原始判断与首次快照" : "Original judgment and snapshot"}</summary>
        {record.initial_judgment ? <dl><div><dt>{zh ? "原始方向" : "Original direction"}</dt><dd>{directions[record.initial_judgment.direction][zh ? 0 : 1]}</dd></div><div><dt>{zh ? "原始理由" : "Original reasoning"}</dt><dd>{record.initial_judgment.reason}</dd></div><div><dt>{zh ? "原始风险" : "Original risks"}</dt><dd>{record.initial_judgment.risks}</dd></div><div><dt>{zh ? "原始失效条件" : "Original invalidation"}</dt><dd>{record.initial_judgment.invalidation || "—"}</dd></div><div><dt>{zh ? "最初计划复核日期" : "Initial review date"}</dt><dd>{record.initial_judgment.review_date || "—"}</dd></div></dl> : <p className={s.note}>{zh ? "旧记录未保存初始版本，无法还原最初判断；以下仅保留首次数据快照。" : "The initial judgment was not retained for this legacy record. Only the original data snapshot is available."}</p>}
        <Snapshot record={record} zh={zh} />
      </details>
      <ResearchReviewHistory record={record} />
      <footer>{!tracking.events.length && <button type="button" onClick={event => { focusTarget.current = event.currentTarget; setMessage(""); setEditing(record); }}>{zh ? "编辑判断" : "Edit judgment"}</button>}<ResearchReviewButton record={record} /><Link href={assetPath(record.symbol)}>{zh ? "返回资产详情" : "View asset"}<ArrowRight size={14} /></Link></footer>
    </article>; })}</div>}
    {editing && <ResearchRecordEditor returnFocus={focusTarget.current} key={editing.id} record={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setMessage(researchSaveLabel(zh, !!user)); }} />}
  </section>;
}

export function ResearchRecordEditor({ asset, history, forecast, record, onClose, onSaved, returnFocus }: { returnFocus?: HTMLElement | null; asset?: Asset; history?: History; forecast?: Forecast; record?: ResearchRecord; onClose: () => void; onSaved: () => void }) {
  const { language, saveResearchRecord } = useApp(); const zh = language === "zh";
  const dialog = useRef<HTMLDialogElement>(null);
  const local = useResearchDraft<RecordDraftEnvelope>(record ? `record:${record.id}` : `new:${asset!.symbol}`, { fields: record || { direction: "neutral", reason: "", risks: "", invalidation: null, review_date: null }, pending: record || null }, (value): value is RecordDraftEnvelope => isRecordDraft(value) && (!value.pending || (value.pending.symbol === (record?.symbol || asset?.symbol) && (!record || value.pending.id === record.id))));
  const draft = local.value.fields;
  const pendingRecord = useRef<ResearchRecord | null>(local.value.pending);
  const locked = useRef(false);
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => { node?.close(); queueMicrotask(() => { if (returnFocus?.isConnected) returnFocus.focus(); }); }; }, [returnFocus]);
  const set = <K extends keyof ResearchDraft>(key: K, value: ResearchDraft[K]) => local.update({ fields: { ...local.current.current.fields, [key]: value }, pending: pendingRecord.current });
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (locked.current || local.loading) return;
    if (!validResearchDraft(draft)) { setError(zh ? "请填写判断理由、主要风险及有效日期。" : "Enter reasoning, main risks and a valid date."); return; }
    locked.current = true; setSaving(true); setError("");
    try {
      if (!pendingRecord.current) pendingRecord.current = makeResearchRecord(asset!, draft, history, forecast);
      local.update({ fields: draft, pending: pendingRecord.current });
      const result = await saveResearchRecord({ ...pendingRecord.current, ...draft });
      if (result !== "saved") throw new Error("Save unconfirmed");
      local.clear(); onSaved();
    } catch { setError(zh ? "保存未确认，输入已保留。请检查浏览器存储空间后重试。" : "Save not confirmed. Your input is retained. Check browser storage and retry before closing."); }
    finally { locked.current = false; setSaving(false); }
  }
  return <dialog ref={dialog} className={s.dialog} aria-labelledby="record-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <header><div><h2 id="record-title">{record ? (zh ? "编辑研究判断" : "Edit research judgment") : (zh ? "保存研究判断" : "Save research judgment")}</h2><p>{record ? `${record.asset_name} · ${record.symbol}` : `${displayAssetName(asset!, language)} · ${asset!.symbol}`}</p></div><button type="button" aria-label={zh ? "关闭" : "Close"} disabled={saving || local.loading} onClick={onClose}><X size={18} /></button></header>
    <form onSubmit={submit}>
      <ResearchDraftStatus {...local} zh={zh} />
      <label>{zh ? "判断方向" : "Direction"}<select aria-label={zh ? "判断方向" : "Direction"} autoFocus value={draft.direction} disabled={saving || local.loading} onChange={e => set("direction", e.target.value as ResearchDraft["direction"])}>{Object.entries(directions).map(([key, labels]) => <option key={key} value={key}>{labels[zh ? 0 : 1]}</option>)}</select></label>
      <label>{zh ? "判断理由" : "Reasoning"}<textarea aria-label={zh ? "判断理由" : "Reasoning"} required maxLength={3000} rows={3} value={draft.reason} disabled={saving || local.loading} onChange={e => set("reason", e.target.value)} placeholder={zh ? "你看到了什么证据，为什么形成这个判断？" : "What evidence supports your view?"} /></label>
      <label>{zh ? "主要风险" : "Main risks"}<textarea aria-label={zh ? "主要风险" : "Main risks"} required maxLength={2000} rows={2} value={draft.risks} disabled={saving || local.loading} onChange={e => set("risks", e.target.value)} placeholder={zh ? "哪些不确定性可能影响判断？" : "What could challenge your view?"} /></label>
      <div className={s.optional}><label>{zh ? "失效条件（可选）" : "Invalidation condition (optional)"}<textarea aria-label={zh ? "失效条件（可选）" : "Invalidation condition (optional)"} maxLength={1000} rows={2} value={draft.invalidation || ""} disabled={saving || local.loading} onChange={e => set("invalidation", e.target.value || null)} /></label><label>{zh ? "复核日期（可选）" : "Review date (optional)"}<input aria-label={zh ? "复核日期（可选）" : "Review date (optional)"} type="date" value={draft.review_date || ""} disabled={saving || local.loading} onChange={e => set("review_date", e.target.value || null)} /></label></div>
      <p className={s.note}>{zh ? "复核日期会加入「今天需要处理」；失效条件仅作个人记录，不自动检测，不改变已有复核计划。" : "Review dates enter your action queue. Invalidation conditions remain personal notes; existing plans are unchanged."}</p>
      {record ? <p className={s.note}>{zh ? "首次保存的行情与预测快照保持不变。" : "The original market and forecast snapshot will remain unchanged."}</p> : <p className={s.note}>{zh ? "保存时附上当前页面已有价格、预测与数据日期；缺失项记为不可用，不会随后补填。数据不保证市场时效。" : "Save includes data already on this page. Missing values stay unavailable and are never backfilled. Market freshness is not guaranteed."}</p>}
      {error && <p role="alert" className={s.error}>{error}</p>}
      <DraftDiscardPrompt requested={local.discardRequested} onKeep={local.keep} onDiscard={() => local.discard(onClose)} zh={zh} />
      <footer><button type="button" disabled={saving || local.loading} onClick={() => local.cancel(onClose)}>{zh ? "取消" : "Cancel"}</button><button type="submit" disabled={saving || local.loading} className={s.primary}>{saving ? (zh ? "保存中…" : "Saving…") : (zh ? "保存判断" : "Save judgment")}</button></footer>
    </form>
  </dialog>;
}
