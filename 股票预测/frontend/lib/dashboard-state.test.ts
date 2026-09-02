import { describe, expect, it } from "vitest";
import { addComparisonDraft, dashboardDestination, parseDashboardViewState, rememberRecentSymbol, replaceDashboardLocation } from "./dashboard-state";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } as Pick<Storage, "getItem" | "setItem">;
}

describe("dashboard state", () => {
  it("parses valid URL state and rejects unsupported values", () => {
    const params = new URLSearchParams("active=nvda&range=5Y&tab=forecast&normalized=0&solo=aapl");
    expect(parseDashboardViewState(params, "SPY")).toEqual({ active: "NVDA", range: "5Y", tab: "forecast", normalized: false, isolated: "AAPL" });
    expect(parseDashboardViewState(new URLSearchParams("range=bad&tab=bad"), "spy").range).toBe("1Y");
  });

  it("builds canonical single and comparison destinations", () => {
    const state = { active: "NVDA", range: "1M" as const, tab: "technical" as const, normalized: true, isolated: null };
    expect(dashboardDestination(["NVDA"], state)).toBe("/stocks/nvda/?range=1M&tab=technical&normalized=1");
    expect(dashboardDestination(["NVDA", "AAPL"], state)).toContain("symbols=NVDA%2CAAPL");
    expect(dashboardDestination(["XYZ"], state)).toContain("symbols=XYZ");
  });

  it("keeps recent symbols ordered and comparison drafts unique", () => {
    const store = storage();
    rememberRecentSymbol(store, "AAPL");
    rememberRecentSymbol(store, "NVDA");
    expect(JSON.parse(store.getItem("orivane-recent-symbols") || "[]")).toEqual(["NVDA", "AAPL"]);
    expect(addComparisonDraft(store, "NVDA", ["AAPL", "NVDA"])).toEqual(["AAPL", "NVDA"]);
  });

  it("updates client-only view state without discarding browser history state", () => {
    const state = { key: "next-router-state" };
    let call: [unknown, string, string] | undefined;
    const history = {
      state,
      replaceState: (data: unknown, unused: string, url: string | URL | null) => {
        call = [data, unused, String(url)];
      },
    } as Pick<History, "state" | "replaceState">;

    replaceDashboardLocation(history, "/stocks/nvda/?range=5Y");

    expect(call).toEqual([state, "", "/stocks/nvda/?range=5Y"]);
  });
});
