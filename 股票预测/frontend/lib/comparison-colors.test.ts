import { describe, expect, it } from "vitest";
import { COMPARISON_COLORS, comparisonColor } from "./comparison-colors";

describe("comparison colors", () => {
  it("provides a distinct color for every supported comparison slot", () => {
    expect(new Set(COMPARISON_COLORS).size).toBe(5);
    expect(comparisonColor(0)).toBe("#11877d");
    expect(comparisonColor(1)).toBe("#d84f4a");
    expect(comparisonColor(5)).toBe(comparisonColor(0));
  });
});
