import { describe, expect, it } from "vitest";
import { hasExactLocalMatch, mergeAssetResults, searchLocalAssets } from "./local-asset-search";

describe("local asset search", () => {
  it("returns semiconductor companies and funds for an industry query", () => {
    const symbols = searchLocalAssets("半导体").map((asset) => asset.symbol);
    expect(symbols).toEqual(expect.arrayContaining(["NVDA", "AMD", "SOXX", "SMH"]));
  });

  it("ranks an exact symbol before partial matches", () => {
    expect(searchLocalAssets("AMD")[0]?.symbol).toBe("AMD");
    expect(searchLocalAssets("600519")[0]?.symbol).toBe("600519.SH");
  });

  it("only skips cloud enrichment for an exact symbol", () => {
    expect(hasExactLocalMatch("AMD", searchLocalAssets("AMD"))).toBe(true);
    expect(hasExactLocalMatch("超威半导体", searchLocalAssets("超威半导体"))).toBe(false);
    expect(hasExactLocalMatch("半导体", searchLocalAssets("半导体"))).toBe(false);
  });

  it("finds localized Chinese company names", () => {
    expect(searchLocalAssets("超威半导体")[0]?.symbol).toBe("AMD");
    expect(searchLocalAssets("贵州茅台")[0]?.symbol).toBe("600519.SH");
    expect(searchLocalAssets("寒武纪")[0]?.symbol).toBe("688256.SH");
    expect(searchLocalAssets("300308")[0]?.symbol).toBe("300308.SZ");
  });

  it("covers Chinese industry discovery beyond the original sample pool", () => {
    const semiconductors = searchLocalAssets("国产芯片").map((asset) => asset.symbol);
    const optical = searchLocalAssets("光模块").map((asset) => asset.symbol);
    expect(semiconductors).toEqual(expect.arrayContaining(["688256.SH", "688981.SH", "002371.SZ"]));
    expect(optical).toEqual(expect.arrayContaining(["300308.SZ"]));
  });

  it("merges cloud results without duplicate symbols", () => {
    const local = searchLocalAssets("英伟达");
    const merged = mergeAssetResults(local, [{ ...local[0], name: "NVIDIA" }]);
    expect(merged.filter((asset) => asset.symbol === "NVDA")).toHaveLength(1);
  });
});
