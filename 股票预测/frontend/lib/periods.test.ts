import { describe, expect, it } from "vitest";
import { periodReturn } from "./periods";
import type { HistoryRecord } from "./types";

const records = Array.from({ length: 8 }, (_, index) => ({
  Date: `2026-06-${String(index + 1).padStart(2, "0")}`,
  Price: 100 + index * 10,
})) as HistoryRecord[];

describe("period returns", () => {
  it("uses trading sessions for short ranges", () => {
    expect(periodReturn(records, "1D")).toBeCloseTo(170 / 160 - 1);
    expect(periodReturn(records, "5D")).toBeCloseTo(170 / 120 - 1);
  });

  it("uses the first available point for all time", () => {
    expect(periodReturn(records, "MAX")).toBeCloseTo(0.7);
  });

  it("ignores invalid non-positive prices in long history", () => {
    expect(periodReturn([
      { Date: "1999-01-01", Price: -0.4 },
      { Date: "2000-01-01", Price: 10 },
      { Date: "2026-01-01", Price: 40 },
    ], "MAX")).toBeCloseTo(3);
  });
});
