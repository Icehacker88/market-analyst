"use client";

import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";
import { useApp } from "./providers";

export function LoadingState({ compact = false, label }: { compact?: boolean; label?: string }) {
  const { t } = useApp();
  return <div className={`state ${compact ? "compact" : ""}`} role="status" aria-live="polite"><LoaderCircle className="spin" size={18} /><span>{label || t("loading")}</span></div>;
}

export function ErrorState({ message, retry, compact = false }: { message: string; retry?: () => void; compact?: boolean }) {
  const { t } = useApp();
  return <div className={`state error ${compact ? "compact" : ""}`} role="alert"><AlertCircle size={18} /><span>{message}</span>{retry && <button onClick={retry}><RefreshCw size={14} />{t("retry")}</button>}</div>;
}

export function EmptyState({ message }: { message?: string }) {
  const { t } = useApp();
  return <div className="state empty" role="status"><span>{message || t("noData")}</span></div>;
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  const { t } = useApp();
  return <div className="skeleton" role="status" aria-label={t("loading")}>{Array.from({ length: rows }).map((_, index) => <i key={index} />)}</div>;
}
