import { formatNumber, formatPercent } from "@/lib/format";
import type { ResearchRecord } from "@/lib/types";
export function ResearchSnapshot({ record, zh, current = false }: { record: ResearchRecord; zh: boolean; current?: boolean }) {
  const f = record.snapshot.forecast; const unavailable = current ? (zh ? "不可用（当前未提供）" : "Currently unavailable") : (zh ? "不可用（保存时未提供）" : "Unavailable at save time");
  const metric = (value: number | null | undefined, percent = false) => typeof value === "number" ? percent ? formatPercent(value, true) : formatNumber(value) : unavailable;
  const rows = [
    [zh ? "参考价格" : "Reference price", `${metric(record.snapshot.reference_price)}${record.snapshot.reference_price !== null && record.currency ? ` ${record.currency}` : ""}`],
    [zh ? "行情数据日期" : "Market data date", record.snapshot.market_data_as_of || unavailable],
    [zh ? "预测方向" : "Forecast direction", f?.signal ? ({ Up: zh ? "偏多" : "Up", Down: zh ? "偏空" : "Down", Observe: zh ? "观望" : "Observe" })[f.signal] : unavailable],
    [zh ? "1D / 5D / 1M 预测收益" : "1D / 5D / 1M forecast returns", [f?.return_1d, f?.return_5d, f?.return_1m].map(v => metric(v, true)).join(" / ")],
    [zh ? "预测数据日期" : "Forecast data date", f?.data_as_of || unavailable],
    [zh ? "预测生成时间" : "Forecast generated at", f?.generated_at || unavailable],
    [zh ? "模型名称" : "Model", f?.model || unavailable],
    [zh ? "模型版本" : "Model version", f?.model_version || unavailable],
    [zh ? "优化参数版本（非模型版本）" : "Optimization version (not model version)", f?.optimization_version || unavailable],
  ];
  return <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
