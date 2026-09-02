import { describe, expect, it } from "vitest";
import { catalogAssetBySymbol } from "./asset-catalog";
import { companyProfileFor } from "./company-profiles";
import { SITE_URL } from "./site";
import { buildStockStructuredData, type SeoForecastSnapshot } from "./stock-structured-data";

const snapshot: SeoForecastSnapshot = {
  data_as_of: "2026-08-25",
  signal: "observe",
  confidence_score: 52,
  forecast_1d_return: 0.1,
  forecast_5d_return: 0.5,
  forecast_10d_return: 0.8,
  forecast_1m_return: 1.2,
};

describe("stock structured data", () => {
  it("meets Google Dataset description and license requirements", () => {
    const asset = catalogAssetBySymbol("NVDA");
    expect(asset).toBeDefined();
    if (!asset) return;

    const schema = buildStockStructuredData({
      asset,
      profile: companyProfileFor(asset),
      snapshot,
      url: `${SITE_URL}/stocks/${asset.slug}/`,
    });
    const dataset = schema["@graph"].find((item) => item["@type"] === "Dataset");

    expect(dataset).toBeDefined();
    expect(String(dataset?.description).length).toBeGreaterThanOrEqual(50);
    expect(String(dataset?.description).length).toBeLessThanOrEqual(5000);
    expect(dataset?.license).toBe(`${SITE_URL}/terms/`);
    expect(dataset?.isAccessibleForFree).toBe(true);
  });

  it("omits Dataset markup when no forecast snapshot exists", () => {
    const asset = catalogAssetBySymbol("AAPL");
    expect(asset).toBeDefined();
    if (!asset) return;

    const schema = buildStockStructuredData({
      asset,
      profile: companyProfileFor(asset),
      url: `${SITE_URL}/stocks/${asset.slug}/`,
    });

    expect(schema["@graph"].some((item) => item["@type"] === "Dataset")).toBe(false);
  });
});
