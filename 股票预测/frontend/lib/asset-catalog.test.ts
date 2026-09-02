import { describe, expect, it } from "vitest";
import { assetPath, catalogAssetBySlug, catalogAssetBySymbol } from "./asset-catalog";

describe("asset catalog", () => {
  it("creates stable stock URLs", () => {
    expect(assetPath("AAPL")).toBe("/stocks/aapl/");
    expect(assetPath("600519.SH")).toBe("/stocks/600519-sh/");
  });

  it("resolves symbols and slugs", () => {
    expect(catalogAssetBySlug("nasdaq-100-index")?.symbol).toBe("^NDX");
    expect(catalogAssetBySymbol("NVDA")?.name_zh).toBe("英伟达");
  });

  it("keeps uncatalogued symbols searchable", () => {
    expect(assetPath("TEST.AX")).toBe("/analysis/?symbols=TEST.AX");
  });
});
