import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset, Forecast, UserState } from "@/lib/types";
import type { ResearchDataEntry } from "@/lib/my-research-data";
import { normalizeUserState } from "@/lib/user-state";
import { RESEARCH_BASELINE_KEY } from "@/lib/my-research";
import { MyResearchWorkspace } from "./my-research-workspace";

const state = vi.hoisted(() => ({ entries: {} as Record<string, ResearchDataEntry>, user: {} as UserState, favorites: [] as Asset[], refresh: vi.fn(), loading: false }));
vi.mock("./use-my-research", () => ({ useMyResearch: () => ({ entries: state.entries, loading: state.loading, lastCheckedAt: Date.now(), refresh: state.refresh }) }));
vi.mock("./providers", () => ({ useApp: () => ({ userState: state.user, favorites: state.favorites, language: "zh", privateStorage: localStorage, toggleFavorite: vi.fn(), updateUserState: vi.fn() }) }));
vi.mock("./asset-logo", () => ({ AssetLogo: () => null }));
vi.mock("./app-link", () => ({ AppLink: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
const initial = { signal: "Up", confidence: 70, invalidation: 90, price: 100, data_as_of: "2026-10-01" };
function entry(symbol: string, signal = "Up"): ResearchDataEntry {
  return { asset: { symbol, name: `Asset ${symbol}`, asset_type: "stock", data_source: "yahoo" }, history: { symbol, data_source: "yahoo", data_as_of: "2026-10-04", snapshot: { latest_price: 95, return_1d: .01 }, records: [] }, forecast: { symbol, signal, data_as_of: "2026-10-04" } as Forecast, status: "fresh", errors: [] };
}
function watchlist(count: number) {
  const symbols = Array.from({ length: count }, (_, index) => `ASSET${index}`);
  state.user = normalizeUserState({ watchlists: [{ id: "default", name: "Default", symbols }] });
  state.entries = Object.fromEntries(symbols.map((symbol) => [symbol, entry(symbol)]));
  state.favorites = symbols.slice(0, 5).map((symbol) => state.entries[symbol].asset!);
  return symbols;
}
function renderWorkspace() { return render(<MyResearchWorkspace onPresetAlert={vi.fn()} />); }
beforeEach(() => { state.entries = {}; state.user = normalizeUserState(); state.favorites = []; state.loading = false; state.refresh.mockReset(); });

describe("My Research visible reliability and action queue", () => {
  it.each([5, 20, 50])("shows all %i saved members even when identity restoration contains only five", (count) => {
    watchlist(count); renderWorkspace();
    expect(screen.getAllByTestId("research-asset")).toHaveLength(count);
    expect(screen.getByText(`已检查 ${count}/${count}`)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`总计 ${count} · 已解析 ${count} · 未检查 0`))).toBeInTheDocument();
    expect(screen.getByText(/尚无历史比较基准；首次成功数据/)).toBeInTheDocument();
    expect(screen.queryByText(/暂无需要处理的重要变化/)).not.toBeInTheDocument();
  });
  it("all failures retain members and never claim no changes or an established baseline", () => {
    const symbols = watchlist(20);
    state.entries = Object.fromEntries(symbols.map((symbol) => [symbol, { status: "failed", errors: [{ kind: "network", message: "Offline" }] }]));
    renderWorkspace();
    expect(screen.getAllByTestId("research-asset")).toHaveLength(20);
    expect(screen.getByText(/20 项获取失败/)).toBeInTheDocument();
    expect(screen.getByText(/尚不能确认全部关注资产的变化/)).toBeInTheDocument();
    expect(screen.queryByText(/暂无需要处理的重要变化/)).not.toBeInTheDocument();
    expect(localStorage.getItem(RESEARCH_BASELINE_KEY)).toBeNull();
  });
  it("shows 18/20 checked and two failures while keeping partial market values", () => {
    const symbols = watchlist(20);
    for (const symbol of symbols.slice(-2)) state.entries[symbol] = { ...entry(symbol), status: "failed", forecast: undefined, errors: [{ kind: "forecast", message: "Unavailable" }] };
    renderWorkspace();
    expect(screen.getByText("已检查 18/20")).toBeInTheDocument();
    expect(screen.getByText(/2 项获取失败/)).toBeInTheDocument();
    expect(screen.getAllByText(/预测缺失；保留可用数据/)).toHaveLength(2);
  });
  it("merges due/reversal/read alert, exposes plan fields, and keeps the item after refresh/remount", () => {
    state.user = normalizeUserState({ watchlists: [{ id: "default", name: "Default", symbols: ["NVDA"] }], research_reviews: { NVDA: { symbol: "NVDA", reason: "invalidation", due_at: "2020-01-02T09:00:00Z", created_at: "2020-01-01", reference_price: 100, trigger_price: 90 } }, alerts: [{ id: "threshold", symbol: "NVDA", type: "below", value: 90, enabled: true }], alert_history: [{ id: "threshold", symbol: "NVDA", type: "below", value: 90, price: 89, change: -.04, triggered_at: "2020-01-03T09:00:00Z", read_at: "2020-01-04" }] });
    state.entries = { NVDA: entry("NVDA", "Down") };
    localStorage.setItem(RESEARCH_BASELINE_KEY, JSON.stringify({ NVDA: initial }));
    const first = renderWorkspace();
    const task = screen.getByTestId("research-task");
    expect(within(task).getByText(/计划已到复核时间/)).toBeInTheDocument();
    expect(within(task).getByText(/偏多 → 偏空/)).toBeInTheDocument();
    expect(within(task).getByText(/已读，未代表已复核/)).toBeInTheDocument();
    expect(within(task).getByText(/参考价 100.*计划关键位 90/)).toBeInTheDocument();
    expect(within(task).getByText(/当前未确认该价格条件已触发/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /完成复核/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    expect(state.refresh).toHaveBeenCalledOnce();
    first.unmount(); renderWorkspace();
    expect(screen.getAllByTestId("research-task")).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(RESEARCH_BASELINE_KEY)!).NVDA).toEqual(initial);
  });
  it("date-only updates do not create tasks and due tasks precede the watchlist", () => {
    state.user = normalizeUserState({ watchlists: [{ id: "default", name: "Default", symbols: ["NVDA"] }] });
    state.entries = { NVDA: entry("NVDA", "Up") };
    localStorage.setItem(RESEARCH_BASELINE_KEY, JSON.stringify({ NVDA: initial }));
    renderWorkspace();
    expect(screen.queryByTestId("research-task")).not.toBeInTheDocument();
    expect(screen.getByText(/暂无需要处理的重要变化/)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent)).toEqual(["今天需要处理", "我的关注", "最近查看"]);
    expect(screen.queryByText("本周研究进度")).not.toBeInTheDocument();
  });
  it("keeps stale data visibly stale instead of claiming it checked", () => {
    watchlist(5); state.entries.ASSET0.status = "stale"; renderWorkspace();
    expect(screen.getByText("已检查 4/5")).toBeInTheDocument();
    expect(screen.getByText(/1 项缓存待更新/)).toBeInTheDocument();
    expect(screen.getByText(/尚不能确认全部关注资产的变化/)).toBeInTheDocument();
  });
  it("has an actionable new-user empty state without fake progress or completion", () => {
    renderWorkspace();
    expect(screen.getByRole("link", { name: /查找资产/ })).toHaveAttribute("href", "/");
    expect(screen.getByText(/不需要凑齐关注数量/)).toBeInTheDocument();
    expect(screen.queryByTestId("research-task")).not.toBeInTheDocument();
  });
});
