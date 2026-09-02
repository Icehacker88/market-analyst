import { describe, expect, it } from "vitest";
import { calculatePortfolioAnalytics } from "./portfolio-analytics";

describe("calculatePortfolioAnalytics", () => {
  it("weights forecasts by current market value", () => {
    const result = calculatePortfolioAnalytics([
      { symbol: "A", marketValue: 75, forecast: { forecast_1d_return: 0.01, forecast_5d_return: 0.02, forecast_1m_return: 0.04, confidence_score: 60 } as never },
      { symbol: "B", marketValue: 25, forecast: { forecast_1d_return: -0.01, forecast_5d_return: 0, forecast_1m_return: -0.02, confidence_score: 40 } as never },
    ]);
    expect(result.expectedReturns["1D"]).toBeCloseTo(0.005);
    expect(result.expectedReturns["1M"]).toBeCloseTo(0.025);
    expect(result.confidence).toBeCloseTo(55);
    expect(result.topWeight).toBeCloseTo(0.75);
  });
});
