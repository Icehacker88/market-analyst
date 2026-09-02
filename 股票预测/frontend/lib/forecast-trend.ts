import type { LedgerStat } from "./types";

export type ForecastTrend = {
  recent: LedgerStat | null;
  overall: LedgerStat | null;
  delta: number | null;
  state: "improving" | "worsening" | "stable" | "unavailable";
};

function matching(stats: LedgerStat[], window: string, horizon: string): LedgerStat | null {
  return stats.find((item) => item.window === window && (!item.horizon || item.horizon === horizon)) || null;
}

export function forecastTrend(stats: LedgerStat[], horizon = "1D"): ForecastTrend {
  const recent = matching(stats, "20", horizon);
  const overall = matching(stats, "All", horizon);
  const recentEdge = Number(recent?.direction_edge);
  const overallEdge = Number(overall?.direction_edge);
  if (!recent || !overall || !Number.isFinite(recentEdge) || !Number.isFinite(overallEdge) || recent.completed < 20 || overall.completed <= recent.completed) {
    return { recent, overall, delta: null, state: "unavailable" };
  }
  const delta = recentEdge - overallEdge;
  return {
    recent,
    overall,
    delta,
    state: delta > 2 ? "improving" : delta < -2 ? "worsening" : "stable",
  };
}
