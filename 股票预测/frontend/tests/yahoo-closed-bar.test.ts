import { describe, expect, it } from "vitest";
import { fillClosedSessionBar, type YahooChartMeta } from "../netlify/functions/_shared/yahoo-chart";

// Real SPY v8 chart shape fetched 2026-10-21 21:56 ET: the 10-21 bar's close/adjclose are null.
const timestamps = [1792503000, 1792589400]; // 10-20 and 10-21 13:30Z
const quote = () => ({ open: [767.1, 771.17], high: [770.2, 774.43], low: [765.9, 768.4], volume: [40e6, 31623572], close: [769.0499877929688, null] as Array<number | null> });
const adjusted = () => [769.0499877929688, null] as Array<number | null>;
const regular = { start: 1792589400, end: 1792612800 }; // 10-21 09:30–16:00 ET
const afterClose: YahooChartMeta = { regularMarketPrice: 773.09, regularMarketTime: 1792612800, gmtoffset: -14400, currentTradingPeriod: { regular } };

describe("Yahoo closed-session bar", () => {
  it("fills the just-closed session's null close from meta, without mutating the input", () => {
    const q = quote(), a = adjusted();
    const filled = fillClosedSessionBar(timestamps, q, a, afterClose);
    expect(filled.quote.close).toEqual([769.0499877929688, 773.09]);
    expect(filled.adjusted).toEqual([769.0499877929688, 773.09]);
    expect(filled.quote.high).toBe(q.high);
    expect(q.close[1]).toBeNull();
    expect(a[1]).toBeNull();
  });

  it("fills after a weekend or holiday, when Yahoo already lists the next session", () => {
    const nextSession = { start: regular.start + 3 * 86400, end: regular.end + 3 * 86400 };
    expect(fillClosedSessionBar(timestamps, quote(), adjusted(), { ...afterClose, currentTradingPeriod: { regular: nextSession } }).quote.close[1]).toBe(773.09);
  });

  it.each([
    ["the session is still open", { ...afterClose, regularMarketTime: 1792600000 }],
    ["meta describes another day", { ...afterClose, regularMarketTime: 1792612800 - 86400 }],
    ["meta has no price", { ...afterClose, regularMarketPrice: undefined }],
    ["meta has no trading period", { ...afterClose, currentTradingPeriod: undefined }],
    ["there is no meta", undefined],
  ])("leaves the bar alone when %s", (_reason, meta) => {
    const q = quote(), a = adjusted();
    const result = fillClosedSessionBar(timestamps, q, a, meta as YahooChartMeta | undefined);
    expect(result.quote).toBe(q);
    expect(result.adjusted).toBe(a);
  });

  it("fills a missing close but keeps a published adjclose and the price series built from it", () => {
    const filled = fillClosedSessionBar(timestamps, quote(), [769.0499877929688, 770.5], afterClose);
    expect(filled.quote.close[1]).toBe(773.09);
    expect(filled.adjusted).toEqual([769.0499877929688, 770.5]);
  });

  it("does not treat an earlier session's end as this bar's close", () => {
    // Stale/mixed meta: regular period is 10-20, while the 10-21 quote is still intraday.
    const previous = { start: regular.start - 86400, end: regular.end - 86400 };
    const stale = { ...afterClose, regularMarketTime: 1792600000, currentTradingPeriod: { regular: previous } };
    expect(fillClosedSessionBar(timestamps, quote(), adjusted(), stale).quote.close[1]).toBeNull();
    // Even with a quote at 16:00 the period still does not belong to this bar.
    expect(fillClosedSessionBar(timestamps, quote(), adjusted(), { ...stale, regularMarketTime: 1792612800 }).quote.close[1]).toBeNull();
  });

  it("never overwrites a close Yahoo already published", () => {
    const q = { ...quote(), close: [769.0499877929688, 773.0900268554688] };
    expect(fillClosedSessionBar(timestamps, q, adjusted(), afterClose).quote).toBe(q);
  });
});
