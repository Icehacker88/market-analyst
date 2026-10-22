// Yahoo's v8 daily chart keeps the just-closed session's bar with close/adjclose = null for
// hours after the close (observed 2026-10-21: still null at 21:56 ET), while meta already
// reports the regular-session close. Dropping that bar made history end a day early, so no
// closed-session forecast could qualify. Fill only that bar, and only once its session is over.
// Every Yahoo daily-history consumer sees the filled bar: charts, returns, indicators, forecast
// inputs, a new freeze's base price, and cloud settlement's target price for that session.
export type YahooChartMeta = {
  regularMarketPrice?: number;
  regularMarketTime?: number;
  gmtoffset?: number;
  currentTradingPeriod?: { regular?: { start?: number; end?: number } };
};

type Series = Array<number | null>;

export function fillClosedSessionBar(timestamps: number[], quote: Record<string, Series>, adjusted: Series, meta: YahooChartMeta | undefined): { quote: Record<string, Series>; adjusted: Series } {
  const last = timestamps.length - 1;
  const price = meta?.regularMarketPrice, at = meta?.regularMarketTime, regular = meta?.currentTradingPeriod?.regular;
  if (last < 0 || !quote.close || quote.close[last] !== null && quote.close[last] !== undefined) return { quote, adjusted };
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || typeof at !== "number") return { quote, adjusted };
  if (typeof regular?.start !== "number" || typeof regular.end !== "number") return { quote, adjusted };
  const localDay = (seconds: number) => new Date((seconds + (meta?.gmtoffset ?? 0)) * 1000).toISOString().slice(0, 10);
  const bar = timestamps[last];
  // Yahoo stamps a daily bar at its session's regular start, so the bar owns `regular` only
  // if it lies inside it; then the quote must be at or after that session's end. Otherwise
  // Yahoo must already list a later session (weekend/holiday). An earlier or unrelated
  // period proves nothing about this bar, so leave it alone.
  const ownsPeriod = regular.start <= bar && bar < regular.end;
  const laterPeriod = regular.start > bar && localDay(regular.start) > localDay(bar);
  if (localDay(at) !== localDay(bar) || (ownsPeriod ? at < regular.end : !laterPeriod)) return { quote, adjusted };
  const close = [...quote.close];
  close[last] = price;
  // Meta is unadjusted: only stand in for a missing adjclose, never replace a published one.
  if (!(adjusted.length > last) || adjusted[last] !== null && adjusted[last] !== undefined) return { quote: { ...quote, close }, adjusted };
  const filledAdjusted = [...adjusted];
  filledAdjusted[last] = price;
  return { quote: { ...quote, close }, adjusted: filledAdjusted };
}
