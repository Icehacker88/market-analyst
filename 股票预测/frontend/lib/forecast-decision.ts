import type { Forecast } from "./types";

export type ForecastDecision = {
  title: string;
  label: string;
  reason: string;
  className: "positive" | "negative" | "observe";
  actionable: boolean;
};

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function forecastDecision(forecast: Forecast, evidenceScore: number, language: "zh" | "en"): ForecastDecision {
  const zh = language === "zh";
  const action = forecast.action;
  const backtestEdge = finite(forecast.validation?.backtest.direction_edge);
  const liveEdge = finite(forecast.validation?.live.direction_edge);
  const liveSamples = forecast.validation?.live.samples ?? 0;
  const evidenceReady = evidenceScore >= 55
    && (backtestEdge === null || backtestEdge > 0)
    && (liveSamples < 20 || liveEdge === null || liveEdge > 0);
  const actionable = action?.actionable === true && evidenceReady;

  if (actionable && action?.stance === "accumulate") return {
    title: zh ? "条件确认后可分批关注" : "Stage interest after confirmation",
    label: zh ? "条件可执行" : "Conditionally actionable",
    reason: zh ? "预测已通过当前证据门槛，仍需等待支撑或突破条件触发。" : "The forecast passes current evidence gates, but support or breakout confirmation is still required.",
    className: "positive",
    actionable: true,
  };
  if (actionable && action?.stance === "reduce") return {
    title: zh ? "优先控制风险" : "Prioritize risk control",
    label: zh ? "风险信号" : "Risk signal",
    reason: zh ? "预测已通过当前证据门槛，风险条件比收益目标更应优先处理。" : "The forecast passes current evidence gates, so risk conditions should take priority over upside targets.",
    className: "negative",
    actionable: true,
  };
  if (actionable && action?.stance === "hold") return {
    title: zh ? "持有观察，不追加强度" : "Hold and monitor; do not chase",
    label: zh ? "持有观察" : "Hold and monitor",
    reason: zh ? "当前证据支持继续观察，但尚不足以主动扩大风险敞口。" : "Current evidence supports monitoring, but not actively increasing risk exposure.",
    className: "observe",
    actionable: true,
  };

  let reason = zh
    ? "模型会继续给出数值路径，但当前不形成买入、加仓或减仓结论。"
    : "The model still provides a numeric path, but it does not currently form a buy, add or trim conclusion.";
  if (action?.evidence_status === "negative_edge" || (backtestEdge !== null && backtestEdge <= 0) || (liveSamples >= 20 && liveEdge !== null && liveEdge <= 0)) {
    reason = zh
      ? "近期或历史验证未优于简单基准，数值走势仅供研究，等待新的正优势证据。"
      : "Recent or historical validation has not beaten the simple baseline, so the numeric path is research-only until positive edge returns.";
  } else if (liveSamples < 20 || action?.evidence_status === "insufficient") {
    reason = zh
      ? `真实冻结样本仅 ${liveSamples} 个，达到验证门槛前不把数值预测解释为操作信号。`
      : `Only ${liveSamples} frozen live samples are available; numeric forecasts are not treated as action signals before the evidence gate is met.`;
  } else if (evidenceScore < 55) {
    reason = zh
      ? `证据质量 ${evidenceScore}/100，尚未达到操作门槛。`
      : `Evidence quality is ${evidenceScore}/100, below the action threshold.`;
  }
  return {
    title: zh ? "等待确认" : "Wait for confirmation",
    label: zh ? "研究观察" : "Research only",
    reason,
    className: "observe",
    actionable: false,
  };
}
