import type { Forecast } from "./types";

export type ForecastBrief = {
  trend: string;
  outlook: string;
  probability: number | null;
  probabilityNote: string;
  holderAdvice: string;
  newcomerAdvice: string;
  tone: "positive" | "negative" | "observe";
};

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Missing prices arrive as null, "" or 0; Number() would turn them into a 0 reference.
function positive(value: unknown): number | null {
  const number = value === null || value === undefined || value === "" ? null : finite(value);
  return number !== null && number > 0 ? number : null;
}

function percent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function price(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export type DirectionalLevels = { downside: number | null; upside: number | null; support: number | null };

// Key levels on the correct side of the current price. A bearish forecast's invalidation
// sits above price, so it is the upside level to reclaim, never a "break below" trigger.
export function directionalLevels(forecast: Forecast, currentPrice?: unknown): DirectionalLevels {
  const reference = positive(currentPrice) ?? positive(forecast.base_price);
  const levels = forecast.key_levels;
  const invalidation = finite(levels?.invalidation);
  const below = (value: number | null) => value !== null && value > 0 && (reference === null || value < reference) ? value : null;
  const above = (value: number | null) => value !== null && value > 0 && (reference === null || value > reference) ? value : null;
  return {
    downside: below(invalidation) ?? below(finite(levels?.stop_loss)) ?? below(finite(levels?.support)),
    upside: above(invalidation) ?? above(finite(levels?.breakout)) ?? above(finite(levels?.resistance)),
    support: finite(levels?.support),
  };
}

// Pass the page's `levels` so this brief and the tailored card name the same prices.
export function forecastBrief(forecast: Forecast, language: "zh" | "en", levels: DirectionalLevels = directionalLevels(forecast)): ForecastBrief {
  const zh = language === "zh";
  const oneDay = finite(forecast.forecast_1d_return) ?? 0;
  const fiveDay = finite(forecast.forecast_5d_return) ?? 0;
  const oneMonth = finite(forecast.forecast_1m_return) ?? fiveDay;
  const weighted = oneDay * 0.2 + fiveDay * 0.3 + oneMonth * 0.5;
  const tone = weighted > 0.004 ? "positive" : weighted < -0.004 ? "negative" : "observe";
  const trend = tone === "positive"
    ? (zh ? (weighted > 0.02 ? "中期偏强上行" : "震荡偏多") : (weighted > 0.02 ? "Constructive uptrend" : "Range with upside bias"))
    : tone === "negative"
      ? (zh ? (weighted < -0.02 ? "中期偏弱下行" : "震荡偏空") : (weighted < -0.02 ? "Weakening downtrend" : "Range with downside bias"))
      : (zh ? "区间震荡" : "Range-bound");

  const live = forecast.validation?.live;
  const calibration = forecast.calibration;
  const backtest = forecast.validation?.backtest;
  const monthModel = forecast.horizon_models?.find((item) => item.horizon === "1M");
  let probability: number | null = null;
  let probabilityNote = zh ? "尚无足够历史样本" : "Not enough historical samples";
  if ((live?.samples ?? 0) >= 20 && finite(live?.direction_accuracy) !== null) {
    probability = finite(live?.direction_accuracy);
    probabilityNote = zh ? `来自 ${live!.samples} 次合格冻结预测` : `From ${live!.samples} qualified frozen forecasts`;
  } else if ((monthModel?.probability_samples ?? 0) >= 20 && finite(monthModel?.direction_probability) !== null) {
    probability = finite(monthModel?.direction_probability);
    probabilityNote = zh ? `来自 1 个月路由模型的 ${monthModel!.probability_samples} 个留出样本` : `From ${monthModel!.probability_samples} holdout samples for the 1M router`;
  } else if ((calibration?.sample_size ?? 0) >= 20 && finite(calibration?.direction_hit_rate) !== null) {
    probability = finite(calibration?.direction_hit_rate);
    probabilityNote = zh ? `来自 ${calibration!.sample_size} 个历史相似信号` : `From ${calibration!.sample_size} similar historical signals`;
  } else if ((backtest?.samples ?? 0) >= 60 && finite(backtest?.direction_accuracy) !== null) {
    probability = finite(backtest?.direction_accuracy);
    probabilityNote = zh ? `来自 ${backtest!.samples} 次走步回测` : `From ${backtest!.samples} walk-forward tests`;
  }
  if (probability !== null) probability = Math.max(0, Math.min(100, probability));

  const { downside, upside, support } = levels;
  const stance = forecast.action?.stance || "wait";
  const actionable = forecast.action?.actionable === true;
  const outlook = zh
    ? `未来 1 日 ${percent(oneDay)}，5 日 ${percent(fiveDay)}，1 个月 ${percent(oneMonth)}。`
    : `1D ${percent(oneDay)}, 5D ${percent(fiveDay)}, and 1M ${percent(oneMonth)}.`;

  let holderAdvice: string;
  let newcomerAdvice: string;
  if (!actionable) {
    // Below the action threshold the page only describes conditions, never position moves.
    holderAdvice = zh ? `证据未达操作门槛，不据此加仓或减仓。下方关注 ${price(downside)} 是否失守，上方关注能否有效站上 ${price(upside)}。` : `Evidence is below the action threshold, so this is not a reason to add or trim. Watch whether ${price(downside)} holds below and whether price can hold above ${price(upside)}.`;
    newcomerAdvice = zh ? `证据未达操作门槛，不构成入场依据。可在 ${price(support)} 附近企稳或有效站上 ${price(upside)} 后重新评估。` : `Evidence is below the action threshold and is not an entry signal. Reassess if ${price(support)} holds or price holds above ${price(upside)}.`;
  } else if (stance === "reduce") {
    holderAdvice = zh ? `反弹时可考虑分批减仓，不建议加仓；跌破 ${price(downside)} 时优先控制风险。` : `Consider trimming into strength and avoid adding; prioritize risk control below ${price(downside)}.`;
    newcomerAdvice = zh ? `暂不适合新开仓，等待重新站稳 ${price(upside)} 或预测转强。` : `Avoid a new entry until price reclaims ${price(upside)} or the forecast improves.`;
  } else if (stance === "accumulate") {
    holderAdvice = zh ? `可继续持有；回踩 ${price(support)} 附近企稳时可考虑小幅分批加仓。` : `Holding remains reasonable; consider small staged adds only if ${price(support)} holds.`;
    newcomerAdvice = zh ? `可等待回踩支撑不破后分批入场，不建议直接追涨。` : `Consider staged entry after a confirmed hold of support; avoid chasing.`;
  } else if (stance === "hold") {
    holderAdvice = zh ? `以持有观察为主，暂不追加强仓；跌破 ${price(downside)} 时考虑减仓。` : `Hold and monitor rather than adding aggressively; consider trimming below ${price(downside)}.`;
    newcomerAdvice = zh ? `等待回踩 ${price(support)} 企稳，或放量突破 ${price(upside)} 后再考虑入场。` : `Wait for support near ${price(support)} to hold or a volume-backed break above ${price(upside)}.`;
  } else {
    holderAdvice = zh ? `不因单次预测立即抛售，但暂不加仓；跌破 ${price(downside)} 时考虑减仓。` : `Do not sell solely on one forecast, but avoid adding; consider trimming below ${price(downside)}.`;
    newcomerAdvice = zh ? `当前更适合等待，至少确认 ${price(support)} 支撑有效或突破 ${price(upside)} 后再入场。` : `Waiting is cleaner until ${price(support)} holds or price breaks above ${price(upside)}.`;
  }

  return { trend, outlook, probability, probabilityNote, holderAdvice, newcomerAdvice, tone };
}
