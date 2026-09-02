import { describe, expect, it } from "vitest";
import { compareSeriesFromHistory, isLongHistoryRange, sliceCompareSeries, validatedPriceRecords } from "./history-series";

describe("history series", () => {
  it("identifies ranges backed by the preloaded full history", () => {
    expect(isLongHistoryRange("5Y")).toBe(true);
    expect(isLongHistoryRange("10Y")).toBe(true);
    expect(isLongHistoryRange("MAX")).toBe(true);
    expect(isLongHistoryRange("1Y")).toBe(false);
  });

  it("recalculates normalized values after slicing a full series", () => {
    const full = compareSeriesFromHistory({
      symbol: "TEST",
      data_source: "test",
      data_as_of: "2026-01-03",
      snapshot: {},
      records: [
        { Date: "2026-01-01", Price: 50 },
        { Date: "2026-01-02", Price: 100 },
        { Date: "2026-01-03", Price: 125 },
      ],
    });

    expect(sliceCompareSeries(full, "2026-01-02").points).toEqual([
      { date: "2026-01-02", price: 100, normalized: 100 },
      { date: "2026-01-03", price: 125, normalized: 125 },
    ]);
  });

  it("trims a distorted forward-adjusted prefix after non-positive prices", () => {
    expect(validatedPriceRecords([
      { Date: "2000-01-01", Price: -0.4 },
      { Date: "2001-01-01", Price: 0.001 },
      { Date: "2001-01-02", Price: 0.04 },
      { Date: "2001-01-03", Price: 0.05 },
      { Date: "2001-01-04", Price: 0.06 },
    ]).map((record) => record.Price)).toEqual([0.04, 0.05, 0.06]);
  });
});
