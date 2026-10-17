import { appendReviewEvent, makeReviewEvent } from "@/lib/research-record-review";
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


vi.mock("./use-my-research", () => ({ useMyResearch: () => ({ entries: {}, loading: false }) }));
function seed(scope = "guest") {
 const r = makeResearchRecord(asset, { direction: "bullish", reason: "Saved original judgment", risks: "Original risk", invalidation: null, review_date: "2020-01-01" });
 const value = normalizeUserState({ research_records: { [r.id]: r } });createPrivateStorage(scope).setItem("orivane-user-state", JSON.stringify(value));return value;
}
async function fillReview(reason = "Manual reassessment") {
 fireEvent.click(await screen.findByRole("button", { name: /^执行复核/ }));
 fireEvent.change(screen.getByLabelText("本次复核理由"), { target: { value: reason } });
 fireEvent.change(screen.getByLabelText("风险变化"), { target: { value: "No new risk observed; data missing" } });
}
async function saveReview() { fireEvent.click(screen.getByRole("button", { name: "保存本次复核" }));await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); }
describe("manual review persistence and UI", () => {
 it("saves without market data, restores history, adjusts direction and archives without editing the original", async () => {
  const original = seed();mount();await ready();await fillReview();
  fireEvent.change(screen.getByLabelText("复核结论"), { target: { value: "adjust" } });fireEvent.change(screen.getByLabelText("调整后的方向"), { target: { value: "bearish" } });await saveReview();
  expect(state().research_records).toEqual(original.research_records);expect(Object.values(state().research_review_events!)[0]).toMatchObject({ outcome: "adjust", direction: "bearish", current_snapshot: { reference_price: null, forecast: null } });
  cleanup();mount();await ready();await waitFor(() => expect(screen.getByText("复核历史 · 1 次")).toBeInTheDocument());
  await fillReview("Tracking ended");fireEvent.change(screen.getByLabelText("复核结论"), { target: { value: "archive" } });await saveReview();
  expect(screen.queryByRole("button", { name: /^执行复核/ })).not.toBeInTheDocument();expect(screen.getByText("已归档")).toBeInTheDocument();expect(Object.keys(state().research_review_events!)).toHaveLength(2);expect(state().research_records).toEqual(original.research_records);
 });
 it("prevents double submission and reuses the event ID after a failed local save", async () => {
  seed();mount();await ready();await fillReview();const fail = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw Error("quota"); });
  fireEvent.click(screen.getByRole("button", { name: "保存本次复核" }));await waitFor(() => expect(screen.getAllByRole("alert").some(node => node.textContent?.includes("保存未确认"))).toBe(true));
  expect(screen.getByLabelText("本次复核理由")).toHaveValue("Manual reassessment");expect(Object.keys(state().research_review_events!)).toHaveLength(0);
  fail.mockRestore();const button=screen.getByRole("button", { name: "保存本次复核" });fireEvent.click(button);fireEvent.click(button);await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());expect(Object.keys(state().research_review_events!)).toHaveLength(1);
 });
 it("preserves offline review events across remount and synchronizes without duplicates", async () => {
  user={ id:"alice", email:"alice@example.test" };remote=seed(privateScope("alice"));vi.mocked(api.saveUserStatePatch).mockRejectedValue(Error("offline"));
  mount();await ready("alice");await waitFor(() => expect(api.getUserState).toHaveBeenCalled());await fillReview("Alice offline review");await saveReview();
  const event=Object.values(state().research_review_events!)[0];await waitFor(async () => expect(await listQueuedStatePatches("alice")).not.toHaveLength(0));
  cleanup();mount();await ready("alice");await waitFor(() => expect(screen.getByText("复核历史 · 1 次")).toBeInTheDocument());expect(screen.queryByText("已同步")).not.toBeInTheDocument();
  vi.mocked(api.saveUserStatePatch).mockImplementation(async patch => remote=normalizeUserState({...remote,...patch}));await act(async () => { window.dispatchEvent(new Event("online")); });await waitFor(async () => expect(await listQueuedStatePatches("alice")).toHaveLength(0));expect(Object.values(remote.research_review_events!)).toEqual([event]);
 });
 it("does not display or upload guest/A review events after switching to B", async () => {
  seed();mount();await ready();await fillReview("Guest review private");await saveReview();cleanup();
  user={id:"alice",email:"alice@example.test"};remote=seed(privateScope("alice"));mount();await ready("alice");await fillReview("Alice review private");await saveReview();
  fireEvent.click(screen.getByText("logout"));await ready();await waitFor(() => expect(screen.getByText("复核历史 · 1 次")).toBeInTheDocument());expect(JSON.stringify(state().research_review_events)).not.toContain("Alice");
  vi.mocked(api.saveUserStatePatch).mockClear();fireEvent.click(screen.getByText("login bob"));await ready("bob");expect(state().research_review_events).toEqual({});await fill("Bob original");await save();await fillReview("Bob review");await saveReview();
  await waitFor(() => expect(api.saveUserStatePatch).toHaveBeenCalled());for(const [patch,options]of vi.mocked(api.saveUserStatePatch).mock.calls){expect(options?.expectedUserId).toBe("bob");expect(JSON.stringify(patch)).not.toMatch(/Guest|Alice/)}
 });
});

it("merges pre-load offline review history with remote history for another record", async () => {
 user={id:"alice",email:"alice@example.test"};const local=seed(privateScope("alice"));
 const older=makeResearchRecord(asset,{direction:"neutral",reason:"Older remote record",risks:"Risk",invalidation:null,review_date:null});
 remote=normalizeUserState({...local,research_records:{...local.research_records,[older.id]:older}});
 remote=appendReviewEvent(remote,makeReviewEvent(older,remote,{outcome:"maintain",direction:"neutral",reason:"Earlier remote review",risk_changes:"Risk stable",next_review_date:null}));
 vi.mocked(api.getUserState).mockRejectedValueOnce(Error("offline"));mount();await ready("alice");await fillReview("Offline local review");await saveReview();
 cleanup();mount();await ready("alice");await waitFor(() => expect(screen.getAllByText("复核历史 · 1 次")).toHaveLength(2));
 await waitFor(async () => expect(await listQueuedStatePatches("alice")).toHaveLength(0));expect(Object.values(remote.research_review_events!).map(e=>e.reason).sort()).toEqual(["Earlier remote review","Offline local review"]);
});
