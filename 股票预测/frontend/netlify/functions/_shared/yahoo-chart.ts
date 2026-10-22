// Yahoo's v8 daily chart keeps the just-closed session's bar with close/adjclose = null for
// hours after the close (observed 2026-10-21: still null at 21:56 ET), while meta already
// reports the regular-session close. Dropping that bar made history end a day early, so no
// closed-session forecast could qualify. Fill only that bar, and only once its session is over.
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
  const barDay = localDay(timestamps[last]);
  // meta must describe the bar's own session, and that session must be over: either its
  // regular period has ended, or Yahoo already lists a later session (weekend/holiday).
  const sessionOver = at >= regular.end || localDay(regular.start) > barDay;
  if (localDay(at) !== barDay || !sessionOver) return { quote, adjusted };
  const close = [...quote.close];
  close[last] = price;
  const filledAdjusted = [...adjusted];
  if (filledAdjusted.length > last) filledAdjusted[last] = price;
  return { quote: { ...quote, close }, adjusted: filledAdjusted };
}
