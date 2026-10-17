"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "./providers";
import { useAuth } from "./auth-provider";

// Writes happen with each input event, using the provider's captured owner. No
// unmount flush can accidentally write the previous account's input to a new one.
export function useResearchDraft<T>(key: string, initial: T, valid: (value: unknown) => value is T) {
  const { privateStorage } = useApp();
  const { loading } = useAuth();
  const storageKey = `research-draft-v1:${key}`;
  const [restored] = useState(() => {
    try {
      const saved = JSON.parse(privateStorage.getItem(storageKey) || "null");
      return saved?.version === 1 && valid(saved.value) ? saved.value as T : null;
    } catch { return null; }
  });
  const [value, setValue] = useState<T>(restored || initial);
  const current = useRef(value);
  const dirty = useRef(Boolean(restored));
  const [stored, setStored] = useState(true);
  const [discardRequested, setDiscardRequested] = useState(false);
  const [hasDraft, setHasDraft] = useState(Boolean(restored));
  function update(next: T) {
    if (loading) return;
    current.current = next; dirty.current = true;
    setValue(next); setHasDraft(true);
    const raw = JSON.stringify({ version: 1, value: next });
    privateStorage.setItem(storageKey, raw);
    setStored(privateStorage.getItem(storageKey) === raw);
  }
  function clear() {
    privateStorage.removeItem(storageKey);
    if (privateStorage.getItem(storageKey) !== null) { setStored(false); return false; }
    dirty.current = false; setHasDraft(false); return true;
  }
  function cancel(onClose: () => void) {
    if (dirty.current) { setDiscardRequested(true); return; }
    if (clear()) onClose();
  }
  function discard(onClose: () => void) { if (clear()) onClose(); }
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);
  return { value, current, update, clear, cancel, discard, discardRequested, keep: () => setDiscardRequested(false), stored, hasDraft, restored: !!restored, loading };
}

export function ResearchDraftStatus({ restored, stored, hasDraft, zh }: { restored: boolean; stored: boolean; hasDraft: boolean; zh: boolean }) {
  if (!hasDraft) return null;
  return <p role={stored ? "status" : "alert"}>{stored
    ? (zh ? `${restored ? "已恢复草稿。" : ""}草稿仅保存在此设备；关闭窗口后可重新打开继续。` : `${restored ? "Draft restored. " : ""}Draft stays on this device; reopen to continue.`)
    : (zh ? "草稿未能保存到设备，请勿刷新或离开；可复制内容后重试。" : "Draft could not be saved on this device. Copy your input before leaving or refreshing.")}</p>;
}

export function DraftDiscardPrompt({ requested, onKeep, onDiscard, zh }: { requested: boolean; onKeep: () => void; onDiscard: () => void; zh: boolean }) {
  if (!requested) return null;
  return <div role="alert" className="draft-discard-prompt"><p>{zh ? "放弃未保存内容并删除本机草稿？" : "Discard unsaved changes and delete this device's draft?"}</p><button type="button" onClick={onKeep}>{zh ? "继续编辑" : "Keep editing"}</button> <button type="button" onClick={onDiscard}>{zh ? "放弃草稿" : "Discard draft"}</button></div>;
}
