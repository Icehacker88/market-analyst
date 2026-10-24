import { HOME_PATH } from "@/lib/api";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHomeData } from "@/lib/api";
import { assetTypeLabels, candidateMetric, discoveryCandidates, periodValue } from "@/lib/home-discovery";
import type { Asset, HomeData } from "@/lib/types";
import { HomeDiscovery } from "./home-discovery";
import { HomeSearch } from "./home-search";

const { push, follow } = vi.hoisted(() => ({ push: vi.fn(), follow: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./providers", () => ({ useApp: () => ({ language: "zh", favorites: [], toggleFavorite: follow, privateStorage: localStorage }) }));
vi.mock("./asset-logo", () => ({ AssetLogo: () => null }));
vi.mock("@/lib/offline-store", () => ({ readOfflineResponse: async () => null, removeOfflineResponse: async () => {}, writeOfflineResponse: async () => {} }));
const asset: Asset = { symbol: "MU", name: "Micron", asset_type: "stock", data_source: "yahoo" };
const data = (value: number): HomeData => ({ gainers: [{ ...asset, return_1y: value, data_as_of: "2026-09-09" }], overview: { gainers: [], losers: [], forecast_movers: [], forecast_bullish: [], forecast_bearish: [], risk_watch: [], data_as_of: "2026-09-09" } });
const response = (value: number) => new Response(JSON.stringify({ data: data(value) }));

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("homepage data semantics and refresh", () => {
  it("never replaces an absent 1M metric with 1D, nor falls back to unrelated lists", () => {
    const metric = candidateMetric({ ...asset, return_1d: .5, forecast_1d_return: .7, forecast_1m_return: null }, "bearish");
    expect(metric.label).toBe("1M");
    expect(periodValue(metric.value, true)).toBe("暂无该周期数据");
    expect(periodValue(0, true)).toBe("0.00%");
    const home = data(1);
    home.overview.forecast_bearish = undefined;
    home.overview.losers = [{ ...home.gainers[0], return_1d: -.2 }] as typeof home.overview.losers;
    expect(discoveryCandidates(home, "bearish")).toEqual([]);
    expect(discoveryCandidates(home, "volatility")).toEqual([]);
  });

  it("shows stale cache, deduplicates its refresh, and replaces visible values after success", async () => {
    localStorage.setItem(`orivane-response-v2:${HOME_PATH}`, JSON.stringify({ value: { data: data(1) }, storedAt: Date.now() - 16 * 60_000 }));
    let release!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    render(<HomeDiscovery />);
    expect(await screen.findByText("+100.00%")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("过期缓存");
    await getHomeData();
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { release(response(2)); });
    expect(await screen.findByText("+200.00%")).toBeVisible();
    expect(screen.queryByText("+100.00%")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已载入");
  });

  it("retains stale values on refresh failure and retries past local caches", async () => {
    localStorage.setItem(`orivane-response-v2:${HOME_PATH}`, JSON.stringify({ value: { data: data(1) }, storedAt: Date.now() - 16 * 60_000 }));
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    render(<HomeDiscovery />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("刷新失败"));
    expect(screen.getByText("+100.00%")).toBeVisible();
    vi.mocked(fetch).mockResolvedValueOnce(response(3));
    fireEvent.click(screen.getByRole("button", { name: "刷新资产数据" }));
    expect(await screen.findByText("+300.00%")).toBeVisible();
    expect(vi.mocked(fetch).mock.calls[1][1]?.cache).toBe("reload");
  });

  it("distinguishes loading, error and empty without fabricated candidates", async () => {
    let release!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    render(<HomeDiscovery />);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await act(async () => { release(new Response("{}", { status: 503 })); });
    expect(screen.getByRole("status")).toHaveTextContent("加载失败");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...data(1), gainers: [] } })));
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("该视角暂无候选"));
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("switches perspectives without API calls and preserves research/follow actions", async () => {
    vi.mocked(fetch).mockResolvedValue(response(1));
    render(<HomeDiscovery />);
    expect(await screen.findByText("1Y 候选内 #1 / 1")).toBeVisible();
    expect(screen.getByText(/本视角 1 只候选/)).toBeVisible();
    expect(await screen.findByRole("link", { name: "查看研究" })).toHaveAttribute("href", expect.stringMatching(/^\/stocks\/mu\/?$/));
    fireEvent.click(screen.getByRole("button", { name: "关注 MU" }));
    expect(follow).toHaveBeenCalledWith(expect.objectContaining({ symbol: "MU" }));
    fireEvent.click(screen.getByRole("button", { name: "1M 预测偏弱" }));
    expect(screen.getByRole("status")).toHaveTextContent("暂无候选");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("homepage search", () => {
  it("keeps Netflix out of ETF results after remote enrichment", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({results: [{symbol: "NFLX", name: "Netflix", asset_type: "stock", data_source: "yahoo"}]})));
    render(<HomeSearch />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ETF" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("条结果"));
    expect(screen.getByRole("grid")).not.toHaveTextContent("NFLX");
    expect(screen.queryByRole("button", {name: "更多操作 NFLX"})).not.toBeInTheDocument();
    expect(screen.getAllByRole("row").length).toBeGreaterThan(0);
  });

  it("keeps explicit ETF, leveraged and inverse labels", () => {
    expect(assetTypeLabels({ ...asset, asset_type: "etf", name: "Example 3x Inverse ETF" }, "zh")).toEqual(["ETF", "杠杆", "反向"]);
    expect(assetTypeLabels({ ...asset, name: "Short Company" }, "zh")).toEqual(["股票"]);
    expect(assetTypeLabels({ ...asset, asset_type: "etf", name: "iShares Ultra Short-Term Bond ETF" }, "zh")).toEqual(["ETF"]);
    expect(assetTypeLabels({ ...asset, asset_type: "etf", name: "ProShares UltraPro Short QQQ" }, "zh")).toEqual(["ETF", "杠杆", "反向"]);
  });

  it("scrolls keyboard selection, removes stale activeDescendant on close, and searches without remote exact-match calls", async () => {
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    render(<HomeSearch />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "NVDA" } });
    await waitFor(() => expect(screen.getByRole("grid")).toBeVisible());
    const activeId = input.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    expect(document.getElementById(activeId!)).toHaveAttribute("role", "row");
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    expect(screen.getByRole("status")).toHaveTextContent("条结果");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/stocks/nvda/");
    expect(fetch).not.toHaveBeenCalled();
    Element.prototype.scrollIntoView = original;
  });

  it.each(["trigger", "menu", "result", "input"])("Escape from %s closes more and restores its trigger without changing selection", async (target) => {
    render(<HomeSearch />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "NVDA" } });
    const trigger = await screen.findByRole("button", { name: "更多操作 NVDA" });
    fireEvent.click(trigger);
    const activeId = input.getAttribute("aria-activedescendant");
    const focus = target === "trigger" ? trigger : target === "menu" ? screen.getByRole("button", { name: "加入对比" }) : target === "input" ? input : within(screen.getByRole("row")).getAllByRole("button")[0];
    act(() => focus.focus());
    fireEvent.keyDown(focus, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "加入对比" })).not.toBeInTheDocument();
    expect(screen.getByRole("grid")).toBeVisible();
    expect(input).toHaveAttribute("aria-activedescendant", activeId);
    expect(push).not.toHaveBeenCalled();
  });

  it("uses the whole main result to open research and keeps secondary actions in more", async () => {
    render(<HomeSearch />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "NVDA" } });
    expect(screen.queryByRole("button", { name: "加入对比" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "更多操作 NVDA" }));
    fireEvent.click(screen.getByRole("button", { name: "设置提醒" }));
    expect(push).toHaveBeenCalledWith("/favorites/?alert=NVDA");
    fireEvent.focus(screen.getByRole("combobox"));
    const row = screen.getByRole("row");
    fireEvent.click(within(row).getAllByRole("button")[0]);
    expect(push).toHaveBeenLastCalledWith("/stocks/nvda/");
  });
});
