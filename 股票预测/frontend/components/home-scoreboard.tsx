"use client";

import { ArrowRight } from "lucide-react";
import { formatMetricPercent } from "@/lib/format";
import type { ForecastScoreboard } from "@/lib/types";
import { AppLink as Link } from "./app-link";
import { useApp } from "./providers";
import { useHomeResource } from "./use-home-resource";
import s from "./home.module.css";

export function HomeScoreboard() {
  const { language } = useApp();
  const zh = language === "zh";
  const { data, status, refreshing, failed, refresh } = useHomeResource<ForecastScoreboard>("/api/forecast/scoreboard?v=2", 1200);
  const backtest = data?.backtest.statistics.find((item) => item.window === "All");
  const live = data?.live.statistics.find((item) => item.window === "All");
  const validationReady = Number(backtest?.direction_edge) > 0 && Number(live?.completed) >= 20 && Number(live?.direction_edge) > 0;
  return <section className={s.scoreboard} aria-labelledby="home-record-title"><header className={s.sectionHeader}><div><h2 id="home-record-title">{zh ? "预测需要验证" : "Forecasts need evidence"}</h2><p>{zh ? "先核对样本与基准，再使用预测研究值。" : "Check samples and baselines before using research forecasts."}</p></div><Link href="/track-record/">{zh ? "完整成绩" : "Full record"}<ArrowRight size={14} /></Link></header>
    <p className={s.status} role="status">{status === "loading" ? (zh ? "正在加载验证数据…" : "Loading validation data…") : status === "error" ? (zh ? "验证数据加载失败。" : "Validation data failed to load.") : status === "stale" ? (failed ? (zh ? "显示过期缓存，刷新失败。" : "Stale cache; refresh failed.") : (zh ? "显示过期缓存，后台刷新中…" : "Stale cache; refreshing…")) : data ? `${zh ? "截至" : "As of"} ${data.data_as_of || (zh ? "暂无日期" : "Date unavailable")} · ${data.symbols.join("、")}` : (zh ? "暂无验证数据" : "No validation data")}{(status === "error" || (status === "stale" && failed)) && <button onClick={refresh} disabled={refreshing}>{zh ? "重试" : "Retry"}</button>}</p>
    <div className={s.recordMetrics}><div><small>{zh ? "走步回测样本" : "Walk-forward samples"}</small><strong>{backtest?.completed ?? "—"}</strong></div><div><small>{zh ? "回测方向优势" : "Backtest direction edge"}</small><strong>{formatMetricPercent(backtest?.direction_edge, true)}</strong></div><div><small>{zh ? "真实冻结样本" : "Frozen live samples"}</small><strong>{live?.completed ?? "—"}</strong></div><div><small>{zh ? "真实方向优势" : "Live direction edge"}</small><strong>{formatMetricPercent(live?.direction_edge, true)}</strong></div></div>
    <p className={s.recordNote}>{data && !validationReady && <>{zh ? "当前模型尚未证明优于简单基准。" : "The model has not yet demonstrated an advantage over a simple baseline. "}</>}{zh ? "回测与真实冻结预测分开统计；少量样本不足以证明预测有效。" : "Backtests and frozen live calls are reported separately; small samples cannot establish forecast effectiveness."}</p>
  </section>;
}
