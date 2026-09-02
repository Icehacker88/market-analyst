"use client";

import { useApp } from "./providers";

const CONTENT = {
  zh: {
    title: "预测方法与使用限制",
    subtitle: "Orivane 用于发现研究线索，不提供买卖指令。",
    sections: [
      ["1. 预测是什么", "预测模块基于历史价格、趋势、波动率、动量、均值回归和突破确认，给出下一交易日、未来 5 日、10 日和 1 个月的走势观察。它表达的是值得继续研究的可能方向，不是保证收益。"],
      ["2. 如何判断可信度", "系统会检查预测日期、走步回测、真实冻结预测、相对多数类基准的方向优势，以及相似信号的历史命中率。未达到门槛时仍显示数值预测，但不会形成仓位建议。"],
      ["3. 模型如何组合", "Orivane 同时运行动量、趋势、均值回归、突破确认、市场状态、自研 K 线结构和历史相似状态模型。与最新行情日期一致时，官方 NeoQuasar Kronos-mini 批量结果以最高 12% 权重加入；基本面、新闻与财报日历只做最高 5% 的事件修正。1 日、5 日、10 日和 1 个月由独立周期路由器分别选择通过留出验证的模型。"],
      ["4. 推荐分数怎么来", "推荐页来自明确标注的核心样本池，综合近一年趋势、近 3 个月动量、波动率、估值和多周期预测。未通过验证门槛的资产只作为研究候选。"],
      ["5. 应该怎么用", "先通过搜索、推荐或选股器发现资产，再查看预测方向、关键价位、情景、历史验证和 AI 解读，最后加入观察列表持续跟踪。"],
      ["6. 什么时候预测会失效", "若价格跌破失效价位，或成交量、市场状态和均线方向明显反向，原预测应降权处理。止损参考、突破位和情景路径会显示在预测页。"],
      ["7. 权重如何自动优化", "核心目录资产每天冻结一次基准预测；收藏资产额外运行深度调权。数值权重按时间顺序从走步样本学习，并且只有在独立留出段保持正方向优势时才启用。系统每日结算真实结果并监控最近 20 个样本，方向优势转负或准确率显著下滑时会暂停候选晋级、关闭未验证叠加信号并回退安全组合。Gemini 只负责解释和提出研究假设，不能直接发布或改写预测数值。"],
      ["8. 区间与情景如何理解", "90% 经验误差区间使用前段走步残差确定宽度，并在后段独立样本验证覆盖率；样本不足时回退波动率区间。情景权重是启发式权重，不是经过概率校准的发生概率。"],
      ["9. 更新与提醒", "定时任务分批冻结核心资产预测，并对收藏资产深度优化。价格越界、预测反转、可信度变化和失效价位触发会去重后发送；每日摘要只在出现新市场数据时生成。"],
    ],
  },
  en: {
    title: "Forecast Methodology and Limitations",
    subtitle: "Orivane surfaces research leads; it does not issue trading instructions.",
    sections: [
      ["1. What the forecast means", "The forecast uses historical price, trend, volatility, momentum, mean reversion and breakout evidence to estimate the next session, 5 days, 10 days and one month. It is a direction for further research, not a guaranteed return."],
      ["2. How credibility is assessed", "The system checks forecast freshness, walk-forward tests, frozen live calls, directional edge over the majority baseline and hit rates for similar historical states. Numeric forecasts remain visible below the threshold, but no position call is issued."],
      ["3. How models are combined", "Orivane combines momentum, trend, mean reversion, breakout, market regime, an in-house K-line structure model and historical analogs. An official NeoQuasar Kronos-mini batch enters at no more than 12% only when its date matches current market data; fundamentals, headlines and the earnings calendar form a capped 5% event overlay. Independent routers validate each horizon separately."],
      ["4. How recommendation scores work", "Recommendations come from a clearly labelled core universe and combine one-year trend, three-month momentum, volatility, valuation and multi-horizon forecasts. Assets below validation thresholds remain research candidates only."],
      ["5. How to use the product", "Find an asset through search, recommendations or the screener; then review direction, key levels, scenarios, historical validation and the AI interpretation before adding it to a watchlist."],
      ["6. When a forecast is invalidated", "A break below the invalidation level, or a clear reversal in volume, market regime and moving-average direction, should reduce the forecast weight. Stop references, breakout levels and scenario paths appear on the forecast page."],
      ["7. How weights are tuned automatically", "Core catalog assets receive a daily frozen baseline forecast, while favorites receive deeper weight tuning. Weights are learned in time order and activate only after positive edge on an independent holdout. Live calls are settled daily; a negative latest-20 edge or material accuracy drop blocks challengers, disables unvalidated overlays and rolls back to the safe ensemble. Gemini explains and proposes research hypotheses but cannot publish or rewrite numeric forecasts."],
      ["8. How to read intervals and scenarios", "The 90% empirical error interval is calibrated on earlier walk-forward residuals and checked on a later independent segment. A volatility fallback is used when samples are limited. Scenario weights are heuristic, not calibrated event probabilities."],
      ["9. Updates and alerts", "Scheduled jobs freeze core forecasts in partitions and deeply optimize favorites. Price thresholds, forecast reversals, confidence changes and invalidation breaches are deduplicated before sending; daily digests are produced only for new market data."],
    ],
  },
} as const;

export function MethodologyContent() {
  const { language } = useApp();
  const content = CONTENT[language];
  return <main className="page-shell method-page">
    <header className="page-title"><div><h1>{content.title}</h1><p>{content.subtitle}</p></div></header>
    <section className="method-grid">{content.sections.map(([title, body]) => <article key={title}><h2>{title}</h2><p>{body}</p></article>)}</section>
  </main>;
}
