import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { ASSET_CATALOG } from "@/lib/asset-catalog";
import { AssetLogo, LOCAL_ASSET_LOGOS, REMOTE_LOGO_UNAVAILABLE } from "./asset-logo";

const AUDITED_REMOTE_GAPS = ["QQQ", "SMH", "ARKK", "NIO", "XPEV", "LI", "300965.SZ"];

describe("asset logo coverage", () => {
  it("keeps local fallbacks for audited blank or missing remote logos", () => {
    expect(AUDITED_REMOTE_GAPS.filter((symbol) => !LOCAL_ASSET_LOGOS[symbol])).toEqual([]);
  });

  it("gives every fund, index and market asset a dedicated logo", () => {
    const uncovered = ASSET_CATALOG
      .filter((asset) => !["stock", "etf"].includes(asset.asset_type))
      .filter((asset) => !LOCAL_ASSET_LOGOS[asset.symbol])
      .map((asset) => asset.symbol);
    expect(uncovered).toEqual([]);
  });

  it("does not request remote logos known to return 404", () => {
    expect([...REMOTE_LOGO_UNAVAILABLE]).toEqual(["301396.SZ"]);
  });

  it("retries transient remote logo failures with a fresh URL", () => {
    const asset = ASSET_CATALOG.find((item) => item.symbol === "NVDA")!;
    const { container } = render(<AssetLogo asset={asset} />);
    const first = container.querySelector("img")!;
    expect(first.src).toContain("retry=0");

    fireEvent.error(first);
    expect(container.querySelector("img")?.src).toContain("retry=1");
  });
});
