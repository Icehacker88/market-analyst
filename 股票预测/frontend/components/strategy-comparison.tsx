"use client";

import { useState } from "react";
import { formatMetricPercent, formatPercent } from "@/lib/format";
import type { ForecastScoreAsset, StrategyComparison, StrategyKey } from "@/lib/types";

const LABELS: Record<StrategyKey, [string, string]> = {
  buy_hold: ["一直持有（基准）", "Buy and hold (benchmark)"],
  long_only: ["只做多：预测上涨时持有", "Long only: hold when up is forecast"],
  long_short: ["按方向多空", "Long/short by direction"],
  actionable_only: ["只按实盘可操作信号", "Live action calls only"],
};

// "If you had followed the signals": hypothetical close-to-close scoring, per asset. Labelled as
// not executable, with every limitation stated, so it is never read as a realised or total return.
export function StrategyComparisonSection({ assets, zh }: { assets: ForecastScoreAsset[]; zh: boolean }) {
  const withStrategy = assets.filter((asset) => asset.strategy);
  const [symbol, setSymbol] = useState(withStrategy[0]?.symbol || "");
  const [source, setSource] = useState<"live" | "backtest">("live");
  if (!withStrategy.length) return null;
  const asset = withStrategy.find((item) => item.symbol === symbol) || withStrategy[0];
  const comparison = asset.strategy![source];
  return <section className="score-strategy" aria-labelledby="score-strategy-title">
    <header>
      <span><h2 id="score-strategy-title">{zh ? "如果按信号操作" : "If the signals had been followed"}</h2><small>{zh ? "假设性收盘价评分（非真实交易收益）" : "Hypothetical close-to-close score (not a realised trading return)"}</small></span>
      <div className="score-strategy-controls">
        <select aria-label={zh ? "资产" : "Asset"} value={asset.symbol} onChange={(event) => setSymbol(event.target.value)}>{withStrategy.map((item) => <option key={item.symbol} value={item.symbol}>{item.symbol}</option>)}</select>
        <div role="tablist" aria-label={zh ? "数据来源" : "Source"}>{(["live", "backtest"] as const).map((item) => <button key={item} role="tab" aria-selected={source === item} className={source === item ? "active" : ""} onClick={() => setSource(item)}>{item === "live" ? (zh ? "实盘（当前版本）" : "Live (current policy)") : (zh ? "走步回测（模拟）" : "Walk-forward backtest (simulated)")}</button>)}</div>
      </div>
    </header>
    <StrategyBody comparison={comparison} zh={zh} />
    <p className="score-note">{zh
      ? `口径：信号在基准日收盘后才发布，实际最早只能在下一交易日开盘进场，而这里从基准日收盘价起算，所以不是可执行收益。按不复权收盘价计算的价格收益：做多不含分红，做空未扣补付的分红（可能高估做空）。每单位换手扣 ${comparison.cost_bps}bps（多头直接翻空扣两倍），不含借券、融资等费用。没有信号的交易日按空仓计；单个资产计算，不跨资产拼接。仅供研究参考，不构成投资建议。`
      : `Basis: signals are published after the base close, so the earliest real entry is the next open, yet each day is scored from the base close; this is not an executable return. Price returns on unadjusted closes: longs exclude dividends and shorts ignore dividends owed (shorts may be overstated). ${comparison.cost_bps}bps per unit of turnover (a long-to-short flip costs twice), excluding borrow and financing. Days without a signal are flat. Computed per asset, never chained across assets. Research only, not investment advice.`}</p>
  </section>;
}

function StrategyBody({ comparison, zh }: { comparison: StrategyComparison; zh: boolean }) {
  if (comparison.status === "no_data") return <p className="score-strategy-empty">{comparison.source === "live" ? (zh ? "暂无当前预测政策版本的已结算合格样本。" : "No settled qualified samples under the current forecast policy yet.") : (zh ? "暂无可评分的回测样本。" : "No scorable backtest samples.")}</p>;
  if (comparison.status === "incomplete_price") return <p className="score-strategy-empty">{zh ? `区间内缺少收盘价（${comparison.reason?.replace("price_missing:", "") || "—"}），不计算评分，也不把缺失当作零收益。` : `A close is missing in the window (${comparison.reason?.replace("price_missing:", "") || "—"}); no score is computed and the gap is not treated as a zero return.`}</p>;
  return <>
    <p className={comparison.sufficient ? "score-strategy-span" : "score-strategy-warning"} role={comparison.sufficient ? undefined : "note"}>
      {zh ? `${comparison.start_target} 至 ${comparison.end_target}，共 ${comparison.days} 个交易日，其中有信号 ${comparison.signal_days} 天、无信号 ${comparison.missing_signal_days} 天。` : `${comparison.start_target} to ${comparison.end_target}: ${comparison.days} sessions, ${comparison.signal_days} with a signal and ${comparison.missing_signal_days} without.`}
      {comparison.sufficient ? "" : (zh ? ` 样本不足（${comparison.signal_days}/${comparison.minimum_samples}），不能作为结论。` : ` Too few samples (${comparison.signal_days}/${comparison.minimum_samples}); not a conclusion.`)}
    </p>
    <div className="table-wrap"><table>
      <thead><tr><th>{zh ? "策略" : "Strategy"}</th><th>{zh ? "累计（扣成本）" : "Cumulative (net)"}</th><th>{zh ? "相对一直持有" : "vs buy and hold"}</th><th>{zh ? "交易次数" : "Trades"}</th><th>{zh ? "胜率" : "Hit rate"}</th><th>{zh ? "最大回撤" : "Max drawdown"}</th></tr></thead>
      <tbody>{comparison.strategies.map((row) => <tr key={row.key}>
        <td>{LABELS[row.key][zh ? 0 : 1]}</td>
        <td>{formatPercent(row.return_net, true)}<small>{zh ? `扣成本前 ${formatPercent(row.return_gross, true)} · 含平仓 ${formatPercent(row.return_after_exit, true)}` : `gross ${formatPercent(row.return_gross, true)} · after exit ${formatPercent(row.return_after_exit, true)}`}</small></td>
        <td>{row.key === "buy_hold" ? "—" : formatPercent(row.excess_vs_hold_net, true)}</td>
        <td>{row.trades}</td>
        <td>{row.win_rate === null ? (zh ? "无持仓" : "No holdings") : formatMetricPercent(row.win_rate)}</td>
        <td>{formatPercent(-row.max_drawdown_net)}</td>
      </tr>)}</tbody>
    </table></div>
  </>;
}
