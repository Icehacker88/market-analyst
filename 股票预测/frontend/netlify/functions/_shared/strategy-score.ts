import { equitySession, followingSessions } from "./forecast-eligibility";

// Hypothetical close-to-close scoring (docs/evidence-governance-plan-2026-10-24.md §3).
// NOT an executable return: a qualified forecast is published after the base close, so the
// earliest real entry is the next open, yet each day is scored from the base close. All
// strategies use price returns (no dividends; shorts owe none here) and a flat cost per unit of
// turnover with no borrow or financing fees. One asset at a time; never chained across assets.
export const STRATEGY_SCORE_RULE = "hypothetical-close-to-close-v1";
export const TRADE_COST_RATE = 0.0005; // 5bps per unit of turnover: 0→1 = 5bps, 1→−1 = 10bps

export type StrategyKey = "buy_hold" | "long_only" | "long_short" | "actionable_only";
// One scored 1D signal per base session: the forecast frozen after that session's close.
export type ScoredSignal = { base: string; forecast: number; action?: string | null };

export type StrategyResult = {
  key: StrategyKey;
  return_net: number;
  return_gross: number;
  return_after_exit: number;
  excess_vs_hold_net: number;
  trades: number;
  holding_days: number;
  win_rate: number | null;
  max_drawdown_net: number;
};

export type StrategyComparison = {
  rule: typeof STRATEGY_SCORE_RULE;
  source: "live" | "backtest";
  basis: "Close";
  cost_bps: number;
  status: "ok" | "no_data" | "incomplete_price";
  reason: string | null;
  start_target: string | null;
  end_target: string | null;
  days: number;
  signal_days: number;
  missing_signal_days: number;
  minimum_samples: number;
  sufficient: boolean;
  strategies: StrategyResult[];
};

const CLOSE_CONFIRMATION_MS = 15 * 60000;

// Latest session whose close the data itself confirms: close + 15 minutes must not be later than
// when the price history was fetched. An intraday fetch, or an intraday cache read after the
// close, leaves that day unconfirmed; early closes come from the reviewed calendar.
export function lastConfirmedSession(observedAt: string | null | undefined): string | null {
  const observed = Date.parse(observedAt ?? "");
  if (!Number.isFinite(observed)) return null;
  for (let offset = 0; offset < 10; offset += 1) {
    const day = new Date(observed - offset * 86400000).toISOString().slice(0, 10);
    const session = equitySession(day);
    if (session && session.close + CLOSE_CONFIRMATION_MS <= observed) return day;
  }
  return null;
}

const WEIGHTS: Record<StrategyKey, (signal: ScoredSignal | undefined) => number> = {
  buy_hold: () => 1,
  long_only: (signal) => signal && signal.forecast > 0 ? 1 : 0,
  long_short: (signal) => signal ? Math.sign(signal.forecast) : 0,
  actionable_only: (signal) => signal?.action === "Up" ? 1 : signal?.action === "Down" ? -1 : 0,
};

// `confirmedThrough`: the last session with a confirmed close (see lastConfirmedSession). Signals
// whose target is later are an unconfirmed tail and are left out rather than scored on a last
// price; `null` means no close is confirmed at all. Omitted only in pure unit tests.
export function scoreStrategies(signals: ScoredSignal[], closes: Map<string, number>, options: { source: "live" | "backtest"; includeActionable: boolean; minimumSamples: number; confirmedThrough?: string | null }): StrategyComparison {
  // Only bases on the reviewed calendar can be checked for gaps; earlier ones are left out.
  const byBase = new Map<string, ScoredSignal>();
  for (const signal of [...signals].sort((a, b) => a.base.localeCompare(b.base))) {
    const target = equitySession(signal.base) ? followingSessions(signal.base, 1)[0] : undefined;
    if (!target || byBase.has(signal.base) || !Number.isFinite(signal.forecast)) continue;
    if (options.confirmedThrough !== undefined && (options.confirmedThrough === null || target > options.confirmedThrough)) continue;
    byBase.set(signal.base, signal);
  }
  const keys: StrategyKey[] = options.includeActionable ? ["buy_hold", "long_only", "long_short", "actionable_only"] : ["buy_hold", "long_only", "long_short"];
  const empty = (status: StrategyComparison["status"], reason: string | null, extra: Partial<StrategyComparison> = {}): StrategyComparison => ({
    rule: STRATEGY_SCORE_RULE, source: options.source, basis: "Close", cost_bps: TRADE_COST_RATE * 10000, status, reason,
    start_target: null, end_target: null, days: 0, signal_days: 0, missing_signal_days: 0, minimum_samples: options.minimumSamples, sufficient: false, strategies: [], ...extra,
  });
  const bases = [...byBase.keys()];
  if (!bases.length) return empty("no_data", options.confirmedThrough === null ? "close_unconfirmed" : null);
  // Day t pairs the signal frozen after base B with the target T = next session: r = Close(T)/Close(B) − 1.
  const lastTarget = followingSessions(bases[bases.length - 1], 1)[0];
  const steps: Array<{ target: string; r: number; signal: ScoredSignal | undefined }> = [];
  for (let base = bases[0]; ;) {
    const target = followingSessions(base, 1)[0];
    if (!target || target > lastTarget) break;
    const from = closes.get(base), to = closes.get(target);
    // A missing price is never a zero return or a silently skipped day.
    if (!(typeof from === "number" && from > 0 && typeof to === "number" && to > 0)) {
      return empty("incomplete_price", `price_missing:${typeof from === "number" && from > 0 ? target : base}`, { start_target: followingSessions(bases[0], 1)[0] });
    }
    steps.push({ target, r: to / from - 1, signal: byBase.get(base) });
    base = target;
  }
  const results = keys.map((key) => {
    let previous = 0, nav = 1, gross = 1, peak = 1, drawdown = 0, trades = 0, holding = 0, wins = 0;
    for (const { r, signal } of steps) {
      const weight = WEIGHTS[key](signal);
      const cost = TRADE_COST_RATE * Math.abs(weight - previous);
      nav *= 1 + weight * r - cost;
      gross *= 1 + weight * r;
      if (weight !== previous) trades += 1;
      if (weight !== 0) { holding += 1; if (weight * r > 0) wins += 1; }
      peak = Math.max(peak, nav); // the initial NAV of 1 is the first peak
      drawdown = Math.max(drawdown, 1 - nav / peak);
      previous = weight;
    }
    return { key, nav, gross, afterExit: nav * (1 - TRADE_COST_RATE * Math.abs(previous)), trades, holding, wins, drawdown };
  });
  const hold = results.find((item) => item.key === "buy_hold")!;
  const signalDays = steps.filter((step) => step.signal).length;
  return {
    ...empty("ok", null),
    start_target: steps[0]?.target ?? null,
    end_target: steps.at(-1)?.target ?? null,
    days: steps.length,
    signal_days: signalDays,
    missing_signal_days: steps.length - signalDays,
    sufficient: signalDays >= options.minimumSamples,
    strategies: results.map((item) => ({
      key: item.key,
      return_net: item.nav - 1,
      return_gross: item.gross - 1,
      return_after_exit: item.afterExit - 1,
      excess_vs_hold_net: item.nav - hold.nav,
      trades: item.trades,
      holding_days: item.holding,
      win_rate: item.holding ? item.wins / item.holding * 100 : null,
      max_drawdown_net: item.drawdown,
    })),
  };
}
