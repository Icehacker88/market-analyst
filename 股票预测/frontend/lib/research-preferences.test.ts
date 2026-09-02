import { describe, expect, it } from "vitest";
import { researchCandidateSymbols } from "./research-preferences";

describe("research preferences", () => {
  it("returns market-specific opportunity candidates", () => {
    expect(researchCandidateSymbols("a", "opportunity")).toEqual(["300750.SZ", "002594.SZ", "300308.SZ"]);
    expect(researchCandidateSymbols("hk", "opportunity")).toContain("0700.HK");
  });

  it("returns diversified learning candidates", () => {
    expect(researchCandidateSymbols("global", "learn")).toEqual(["QQQ", "300750.SZ", "0700.HK"]);
  });
});
