import { describe, expect, it } from "vitest";
import { canonicalizeAsset, displayAssetName } from "./assets";
import type { Asset } from "./types";

const asset = (symbol: string, name: string): Asset => ({
  symbol,
  name,
  name_en: name,
  asset_type: "stock",
  exchange: "SZSE",
  currency: "CNY",
  data_source: "yahoo",
});

describe("asset name localization", () => {
  it("uses Chinese names for dynamically resolved A-shares", () => {
    const zhongji = canonicalizeAsset(asset("300308.SZ", "Zhongji Innolight Co., Ltd."));
    const gloryView = canonicalizeAsset(asset("301396.SZ", "Glory View Technology Co., Ltd."));

    expect(displayAssetName(zhongji, "zh")).toBe("中际旭创");
    expect(displayAssetName(gloryView, "zh")).toBe("宏景科技");
    expect(displayAssetName(zhongji, "en")).toBe("Zhong Ji Xu Chuang");
    expect(displayAssetName(gloryView, "en")).toBe("Hong Jing Ke Ji");
  });

  it("never falls back to an English company name in Chinese mode", () => {
    expect(displayAssetName(asset("688999.SH", "Example Technology Inc."), "zh")).toBe("股票 688999.SH");
  });
});
