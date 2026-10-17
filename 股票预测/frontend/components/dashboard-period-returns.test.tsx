import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import type { History, PeriodReturns } from "@/lib/types";
import { Dashboard } from "./dashboard";

let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => search,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
const storageValues = vi.hoisted(() => new Map<string, string>());
// Stable like the real provider: Dashboard callbacks depend on `t` and storage identity.
const app = vi.hoisted(() => ({
  language: "zh",
  t: (key: string) => key,
  privateStorage: {
    getItem: (key: string): string | null => storageValues.get(key) ?? null,
    setItem: (key: string, value: string) => { storageValues.set(key, value); },
    removeItem: (key: string) => { storageValues.delete(key); },
  },
}));
vi.mock("./providers", () => ({ useApp: () => app }));
vi.mock("./search-assets", () => ({ SearchAssets: () => null }));
vi.mock("./research-records", () => ({ SingleAssetResearchEntry: () => null }));
vi.mock("./overview-card", () => ({ OverviewCard: () => null }));
vi.mock("./comparison-decision-table", () => ({ ComparisonDecisionTable: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/api", () => ({
  compareAssets: vi.fn(),
  getCompanyResearch: vi.fn(),
  getForecast: vi.fn(),
  getHistory: vi.fn(),
  getMarketSnapshots: vi.fn(),
  getPerformance: vi.fn(),
  getPeriodReturns: vi.fn(),
  getPredictionHistory: vi.fn(),
  resolveAssets: vi.fn(),
}));

const AS_OF = "2026-10-16";

// Daily closes at 100 from `start`, then 110 on the last session: every covered
// recent range reads +10.00%.
function dailyHistory(start: string): History {
  const records = [];
  for (let day = new Date(`${start}T00:00:00Z`); day.toISOString().slice(0, 10) < AS_OF; day.setUTCDate(day.getUTCDate() + 1)) {
    records.push({ Date: day.toISOString().slice(0, 10), Price: 100 });
  }
  records.push({ Date: AS_OF, Price: 110 });
  return { symbol: "NVDA", data_source: "yahoo", data_as_of: AS_OF, snapshot: {}, records };
}

// Full-history shape: monthly bars whose last bar already holds the latest close.
const monthlyHistory: History = {
  symbol: "NVDA",
  data_source: "yahoo",
  data_as_of: AS_OF,
  snapshot: {},
  records: [
    { Date: "2000-01-01", Price: 1 },
    { Date: "2026-09-01", Price: 120 },
    { Date: "2026-10-01", Price: 110 },
    { Date: AS_OF, Price: 110 },
  ],
};

// A /api/market/returns response cached a day earlier than the history on screen.
const staleRecent: PeriodReturns = {
  symbol: "NVDA",
  data_as_of: "2026-10-15",
  long_term_complete: false,
  returns: { "1D": -0.02, "5D": -0.03, "1M": -0.04, "6M": 0.3, YTD: 0.4, "1Y": 0.5 },
};

function strip(container: HTMLElement): Record<string, string> {
  return Object.fromEntries([...container.querySelectorAll(".period-return-strip button")].map((button) => [
    button.querySelector("span")!.textContent,
    button.querySelector("strong")!.textContent,
  ]));
}

// Small steps so React commits state between timers, as it does in a browser.
async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 250) {
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  }
}

function recentCalls() {
  return vi.mocked(api.getPeriodReturns).mock.calls.filter(([, scope]) => scope === "recent").length;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date(`${AS_OF}T12:00:00Z`));
  storageValues.clear();
  vi.mocked(api.getHistory).mockImplementation(async (_asset, start) => dailyHistory(start));
  vi.mocked(api.getMarketSnapshots).mockResolvedValue([{ asset: { symbol: "NVDA" }, history: monthlyHistory }] as unknown as Awaited<ReturnType<typeof api.getMarketSnapshots>>);
  vi.mocked(api.getForecast).mockReturnValue(new Promise(() => {}));
  vi.mocked(api.resolveAssets).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Dashboard period returns", () => {
  it("keeps daily short returns after the monthly full history arrives", async () => {
    search = new URLSearchParams();
    vi.mocked(api.getPeriodReturns).mockResolvedValue(staleRecent);
    const { container } = render(<Dashboard initialSymbols={["NVDA"]} />);
    await advance(10_000);

    const values = strip(container);
    expect(values.period1d).toBe("+10.00%");
    expect(values.period5d).toBe("+10.00%");
    expect(values.period1m).toBe("+10.00%");
    expect(values.period1y).toBe("+10.00%");
    expect(values.periodAll).toBe("+10900.00%");
    expect(recentCalls()).toBe(0);
  });

  it("fills only missing ranges from a stale recent response, once", async () => {
    search = new URLSearchParams("range=1M");
    vi.mocked(api.getPeriodReturns).mockResolvedValue(staleRecent);
    const { container } = render(<Dashboard initialSymbols={["NVDA"]} />);
    await advance(1_000);
    expect(strip(container).period6m).toBe("—");

    await advance(30_000);
    const values = strip(container);
    expect(values.period1d).toBe("+10.00%");
    expect(values.period5d).toBe("+10.00%");
    expect(values.period1m).toBe("+10.00%");
    expect(values.period6m).toBe("+30.00%");
    expect(values.periodYtd).toBe("+40.00%");
    expect(values.period1y).toBe("+50.00%");
    expect(recentCalls()).toBe(1);
  });

  it("keeps fresh daily returns when a pending recent response lands after a range switch", async () => {
    search = new URLSearchParams("range=1M");
    let resolveRecent!: (value: PeriodReturns) => void;
    vi.mocked(api.getPeriodReturns).mockReturnValue(new Promise((resolve) => { resolveRecent = resolve; }));
    const { container } = render(<Dashboard initialSymbols={["NVDA"]} />);
    await advance(5_000);
    expect(recentCalls()).toBe(1);

    const oneYear = [...container.querySelectorAll(".period-return-strip button")].find((button) => button.querySelector("span")!.textContent === "period1y")!;
    fireEvent.click(oneYear);
    await advance(1_000);
    expect(strip(container).period6m).toBe("+10.00%");

    await act(async () => { resolveRecent(staleRecent); });
    await advance(10_000);
    const values = strip(container);
    expect(values.period1d).toBe("+10.00%");
    expect(values.period6m).toBe("+10.00%");
    expect(values.period1y).toBe("+10.00%");
    expect(recentCalls()).toBe(1);
  });
});
