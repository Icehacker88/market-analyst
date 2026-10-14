import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { listQueuedStatePatches } from "@/lib/offline-store";
import { createPrivateStorage, privateScope } from "@/lib/private-storage";
import { makeResearchRecord } from "@/lib/research-record";
import { normalizeUserState } from "@/lib/user-state";
import type { Asset, AuthUser, UserState } from "@/lib/types";
import { Providers, useApp } from "./providers";
import { useAuth } from "./auth-provider";
import { ResearchRecordEntry, ResearchRecords } from "./research-records";
vi.mock("@/lib/api", async original => ({ ...await original<typeof api>(), getAuthConfig: vi.fn(), getCurrentUser: vi.fn(), getUserState: vi.fn(), saveUserStatePatch: vi.fn(), resolveAssets: vi.fn(), loginWithEmailApi: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn(), observeWebVitals: () => () => {} }));
vi.mock("./pwa-runtime", () => ({ PwaRuntime: () => null }));
const asset: Asset = { symbol: "NVDA", name: "Nvidia", asset_type: "stock", data_source: "yahoo" };
let user: AuthUser | null; let remote: UserState;
function App() { const app = useApp(), auth = useAuth(); return <><output data-testid="identity">{auth.loading ? "pending" : auth.user?.id || "guest"}</output><output data-testid="state">{JSON.stringify(app.userState)}</output><button onClick={() => void auth.signOut()}>logout</button><button onClick={() => void auth.loginWithEmail("bob@example.test", "test")}>login bob</button><ResearchRecordEntry asset={asset} /><ResearchRecords /></>; }
function mount() { return render(<Providers><App /></Providers>); }
async function ready(id = "guest") { await waitFor(() => expect(screen.getByTestId("identity")).toHaveTextContent(id)); }
async function fill(reason = "Demand remains strong") {
 fireEvent.click(screen.getByRole("button", { name: "保存研究判断" }));
 fireEvent.change(screen.getByLabelText("判断方向"), { target: { value: "bullish" } });
 fireEvent.change(screen.getByLabelText("判断理由"), { target: { value: reason } });
 fireEvent.change(screen.getByLabelText("主要风险"), { target: { value: "Valuation risk" } });
 fireEvent.change(screen.getByLabelText("复核日期（可选）"), { target: { value: "2026-11-01" } });
}
async function save() { fireEvent.click(screen.getByRole("button", { name: "保存判断" })); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); }
const state = () => JSON.parse(screen.getByTestId("state").textContent!) as UserState;
beforeEach(() => {
 vi.clearAllMocks(); user = null; remote = normalizeUserState();
 vi.stubGlobal("indexedDB", new IDBFactory());
 Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
 Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
 vi.mocked(api.getAuthConfig).mockResolvedValue({ googleEnabled: false, appleEnabled: false, signupEnabled: true });
 vi.mocked(api.getCurrentUser).mockImplementation(async () => user);
 vi.mocked(api.getUserState).mockImplementation(async () => remote);
 vi.mocked(api.saveUserStatePatch).mockImplementation(async patch => remote = normalizeUserState({ ...remote, ...patch }));
 vi.mocked(api.resolveAssets).mockResolvedValue([]);
 vi.mocked(api.loginWithEmailApi).mockImplementation(async () => { user = { id: "bob", email: "bob@example.test" }; remote = normalizeUserState(); return { user }; });
 vi.stubGlobal("fetch", vi.fn(async () => { user = null; return new Response("{}"); }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Research Record usable local save flows", () => {
 it("creates without market data, restores after refresh, edits one stable record, and leaves missing snapshot unavailable", async () => {
  mount(); await ready(); await fill(); await save();
  const original = Object.values(state().research_records!)[0]; expect(original.snapshot).toEqual({ reference_price: null, market_data_as_of: null, forecast: null });
  expect(original.review_date).toBe("2026-11-01"); expect(state().research_reviews).toEqual({});
  expect(createPrivateStorage("guest").getItem("orivane-user-state")).toContain("Demand remains strong");
  cleanup(); mount(); await ready(); await waitFor(() => expect(screen.getAllByText("Demand remains strong").length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole("button", { name: "编辑判断" })); fireEvent.change(screen.getByLabelText("判断理由"), { target: { value: "Updated view" } }); await save();
  expect(Object.values(state().research_records!)).toEqual([expect.objectContaining({ id: original.id, reason: "Updated view", created_at: original.created_at, snapshot: original.snapshot })]);
  expect(screen.getByRole("link", { name: "返回资产详情" })).toHaveAttribute("href", "/stocks/nvda");
 });
 it("retains input and avoids success or memory-only records when local persistence fails", async () => {
  mount(); await ready(); await fill(); const broken = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw Error("quota"); });
  fireEvent.click(screen.getByRole("button", { name: "保存判断" }));
  await waitFor(() => expect(screen.getAllByRole("alert").some(node => node.textContent?.includes("保存未确认"))).toBe(true));
  expect(screen.getByLabelText("判断理由")).toHaveValue("Demand remains strong"); expect(state().research_records).toEqual({});
  broken.mockRestore(); await save(); expect(Object.keys(state().research_records!)).toHaveLength(1);
 });
 it("keeps a logged-in record and queue through cloud failure and refresh; later sync does not duplicate it", async () => {
  user = { id: "alice", email: "alice@example.test" }; vi.mocked(api.saveUserStatePatch).mockRejectedValue(new Error("offline"));
  mount(); await ready("alice"); await waitFor(() => expect(api.getUserState).toHaveBeenCalled()); await fill("Alice judgment"); await save();
  await waitFor(async () => expect(await listQueuedStatePatches("alice")).not.toHaveLength(0));
  cleanup(); mount(); await ready("alice"); await waitFor(() => expect(screen.getAllByText("Alice judgment").length).toBeGreaterThan(0));
  expect(screen.queryByText("已同步")).not.toBeInTheDocument();
  vi.mocked(api.saveUserStatePatch).mockImplementation(async patch => remote = normalizeUserState({ ...remote, ...patch }));
  await act(async () => { window.dispatchEvent(new Event("online")); });
  await waitFor(async () => expect(await listQueuedStatePatches("alice")).toHaveLength(0));
  expect(Object.keys(remote.research_records!)).toHaveLength(1);
 });
 it("does not show or upload a guest or Alice record after switching to Bob", async () => {
  mount(); await ready(); await fill("Guest judgment"); await save(); cleanup();
  user = { id: "alice", email: "alice@example.test" }; mount(); await ready("alice"); expect(screen.queryByText("Guest judgment")).not.toBeInTheDocument();
  await fill("Alice private judgment"); await save();
  fireEvent.click(screen.getByText("logout")); await ready(); expect(screen.queryByText("Alice private judgment")).not.toBeInTheDocument(); await waitFor(() => expect(screen.getAllByText("Guest judgment").length).toBeGreaterThan(0));
  vi.mocked(api.saveUserStatePatch).mockClear(); fireEvent.click(screen.getByText("login bob")); await ready("bob");
  expect(screen.queryByText("Guest judgment")).not.toBeInTheDocument(); expect(screen.queryByText("Alice private judgment")).not.toBeInTheDocument();
  await fill("Bob judgment"); await save(); await waitFor(() => expect(api.saveUserStatePatch).toHaveBeenCalled());
  for (const [patch, options] of vi.mocked(api.saveUserStatePatch).mock.calls) { expect(options?.expectedUserId).toBe("bob"); expect(JSON.stringify(patch)).not.toMatch(/Alice|Guest/); }
  expect(createPrivateStorage(privateScope("bob")).getItem("orivane-user-state")).toContain("Bob judgment");
 });
 it("merges a pre-load offline record with existing cloud records by ID", async () => {
  user = { id: "alice", email: "alice@example.test" };
  const older = makeResearchRecord(asset, { direction: "neutral", reason: "Older cloud view", risks: "Risk", invalidation: null, review_date: null });
  remote = normalizeUserState({ research_records: { [older.id]: older } });
  vi.mocked(api.getUserState).mockRejectedValueOnce(Error("offline"));
  mount(); await ready("alice"); await fill("New offline view"); await save();
  cleanup(); mount(); await ready("alice");
  await waitFor(() => expect(screen.getAllByText("Older cloud view").length).toBeGreaterThan(0));
  expect(screen.getAllByText("New offline view").length).toBeGreaterThan(0);
  await waitFor(() => expect(Object.keys(remote.research_records!)).toHaveLength(2));
 });
 it("preserves an existing review plan in legacy state when adding a record", async () => {
  const legacy = normalizeUserState({ research_reviews: { NVDA: { symbol: "NVDA", reason: "breakout", due_at: "2026-11-01", created_at: "2026-10-01" } } });
  delete legacy.research_records; createPrivateStorage("guest").setItem("orivane-user-state", JSON.stringify(legacy));
  mount(); await ready(); await fill(); await save(); expect(state().research_reviews).toEqual(legacy.research_reviews);
 });
});
