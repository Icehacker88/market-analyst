import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createPrivateStorage, privateScope } from "@/lib/private-storage";
import { makeResearchRecord } from "@/lib/research-record";
import { appendReviewEvent, makeReviewEvent } from "@/lib/research-record-review";
import { normalizeUserState } from "@/lib/user-state";
import type { Asset, AuthUser, UserState, ResearchRecord } from "@/lib/types";
import { Providers, useApp } from "./providers";
import { useAuth } from "./auth-provider";
import { ResearchRecordEntry, ResearchRecords, SingleAssetResearchEntry } from "./research-records";
import { MyResearchWorkspace } from "./my-research-workspace";
vi.mock("@/lib/api", async original => ({ ...await original<typeof api>(), getAuthConfig: vi.fn(), getCurrentUser: vi.fn(), getUserState: vi.fn(), saveUserStatePatch: vi.fn(), resolveAssets: vi.fn(), loginWithEmailApi: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn(), observeWebVitals: () => () => {} }));
vi.mock("./pwa-runtime", () => ({ PwaRuntime: () => null }));
vi.mock("./use-my-research", () => ({ useMyResearch: () => ({ entries: {}, loading: false, refresh: vi.fn() }) }));
const asset: Asset = { symbol: "NVDA", name: "Nvidia", asset_type: "stock", data_source: "yahoo" };
let user: AuthUser | null; let remote: UserState;
function App({ workspace = false }: { workspace?: boolean }) {
 const app = useApp(), auth = useAuth();
 return <><output data-testid="identity">{auth.loading ? "pending" : auth.user?.id || "guest"}</output><output data-testid="state">{JSON.stringify(app.userState)}</output><ResearchRecordEntry asset={asset} />{workspace && <MyResearchWorkspace onPresetAlert={() => {}} />}<ResearchRecords /></>;
}
function mount(workspace = false) { return render(<Providers><App workspace={workspace} /></Providers>); }
async function ready(id = "guest") { await waitFor(() => expect(screen.getByTestId("identity")).toHaveTextContent(id)); }
const state = () => JSON.parse(screen.getByTestId("state").textContent!) as UserState;
function draftText(value: string) { fireEvent.change(screen.getByLabelText("判断理由"), { target: { value } }); }
function openRecord() { fireEvent.click(screen.getByRole("button", { name: "保存研究判断" })); }
function record(reason = "Original reason") { return makeResearchRecord(asset, { direction: "bullish", reason, risks: "Original risk", invalidation: "Demand fails", review_date: "2020-01-01" }); }
function seed(records: ResearchRecord[], scope = "guest") {
 const value = normalizeUserState({ research_records: Object.fromEntries(records.map(r => [r.id, r])) });
 createPrivateStorage(scope).setItem("orivane-user-state", JSON.stringify(value)); return value;
}
async function openReview(id: string) { fireEvent.click(await screen.findByRole("button", { name: `执行复核 NVDA ${id}` })); }
function fillReview(reason = "Revised evidence") {
 fireEvent.change(screen.getByLabelText("本次复核理由"), { target: { value: reason } });
 fireEvent.change(screen.getByLabelText("风险变化"), { target: { value: "Risk has changed" } });
}
async function submitReview() { fireEvent.click(screen.getByRole("button", { name: "保存本次复核" })); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument()); }
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
describe("Core journey draft protection", () => {
 it("restores incomplete input after close and refresh, confirms discard, and clears after success", async () => {
  mount(); await ready(); openRecord(); draftText("Half written");
  const leaving = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(leaving); expect(leaving.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "关闭" })); openRecord(); expect(screen.getByLabelText("判断理由")).toHaveValue("Half written");
  cleanup(); mount(); await ready(); openRecord(); expect(screen.getByLabelText("判断理由")).toHaveValue("Half written");

  fireEvent.click(screen.getByRole("button", { name: "取消" })); expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "继续编辑" })); fireEvent.click(screen.getByRole("button", { name: "取消" })); fireEvent.click(screen.getByRole("button", { name: "放弃草稿" })); openRecord(); expect(screen.getByLabelText("判断理由")).toHaveValue("");
  draftText("Saved judgment"); fireEvent.change(screen.getByLabelText("主要风险"), { target: { value: "Risk" } }); fireEvent.click(screen.getByRole("button", { name: "保存判断" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(createPrivateStorage("guest").getItem("research-draft-v1:new:NVDA")).toBeNull();
  expect(screen.getByText("仅保存在此设备")).toBeInTheDocument();
  openRecord(); expect(screen.getByLabelText("判断理由")).toHaveValue("");
 });
 it("isolates guest/A/B drafts and never writes during session restoration or uploads drafts", async () => {
  mount(); await ready(); openRecord(); draftText("Guest unfinished"); cleanup();
  user = {id:"alice",email:"alice@example.test"}; mount(); await ready("alice"); openRecord(); expect(screen.getByLabelText("判断理由")).toHaveValue(""); draftText("Alice unfinished");
  let resolve!: (user: AuthUser | null) => void;
  vi.mocked(api.getCurrentUser).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(async () => { window.dispatchEvent(new Event("focus")); }); await ready("pending");
  openRecord(); draftText("Do not persist pending input");
  user = {id:"bob",email:"bob@example.test"}; await act(async () => { resolve(user); }); await ready("bob"); openRecord(); expect(screen.getByLabelText("判断理由")).toHaveValue(""); draftText("Bob unfinished");
  expect(createPrivateStorage(privateScope("alice")).getItem("research-draft-v1:new:NVDA")).toContain("Alice unfinished");
  expect(createPrivateStorage(privateScope("bob")).getItem("research-draft-v1:new:NVDA")).not.toMatch(/Alice unfinished|Guest unfinished|Do not persist/);
  expect(createPrivateStorage("guest").getItem("research-draft-v1:new:NVDA")).toContain("Guest unfinished");
  expect(api.saveUserStatePatch).not.toHaveBeenCalled();
  cleanup(); user={id:"alice",email:"alice@example.test"}; mount(); await ready("alice"); openRecord(); expect(screen.getByLabelText("判断理由")).toHaveValue("Alice unfinished");
 });
 it("keeps review drafts for different records of one symbol separate and can discard them", async () => {
  const a=record("A"), b=record("B"); seed([a,b]); mount(); await ready(); await openReview(a.id); fillReview("Review A"); fireEvent.click(screen.getByRole("button",{name:"关闭复核"}));
  await openReview(b.id); expect(screen.getByLabelText("本次复核理由")).toHaveValue(""); fillReview("Review B"); fireEvent.click(screen.getByRole("button",{name:"关闭复核"}));
  cleanup(); mount(); await ready(); await openReview(a.id); expect(screen.getByLabelText("本次复核理由")).toHaveValue("Review A");
  fireEvent.click(screen.getByRole("button",{name:"取消"})); fireEvent.click(screen.getByRole("button",{name:"放弃草稿"})); await openReview(a.id); expect(screen.getByLabelText("本次复核理由")).toHaveValue("");
  fireEvent.click(screen.getByRole("button",{name:"关闭复核"})); await openReview(b.id); expect(screen.getByLabelText("本次复核理由")).toHaveValue("Review B");
 });
 it("rejects a restored draft when its parent changed, rather than rebasing it silently", async () => {
  const r=record(); const original=seed([r]); mount(); await ready(); await openReview(r.id); fillReview("Old draft"); cleanup();
  const incoming=makeReviewEvent(r,original,{outcome:"adjust",direction:"bearish",reason:"Other device review",risk_changes:"Risk",next_review_date:null});
  createPrivateStorage("guest").setItem("orivane-user-state",JSON.stringify(appendReviewEvent(original,incoming)));
  mount(); await ready(); await openReview(r.id); expect(screen.getByLabelText("本次复核理由")).toHaveValue("Old draft");
  fireEvent.click(screen.getByRole("button",{name:"保存本次复核"})); await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("放弃旧草稿"));
  expect(Object.keys(state().research_review_events!)).toHaveLength(1); expect(screen.queryByText("复核已保存")).not.toBeInTheDocument();
 });
 it("keeps a failed pending event's ID and snapshot across refresh and clears the draft only on durable success", async () => {
  const r=record(); seed([r]); mount(); await ready(); await openReview(r.id); fillReview();
  const originalSet=localStorage.setItem.bind(localStorage);
  const fail=vi.spyOn(localStorage,"setItem").mockImplementation((k,v)=>{if(k.endsWith(":orivane-user-state"))throw Error("quota");originalSet(k,v)});
  fireEvent.click(screen.getByRole("button",{name:"保存本次复核"})); await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("保存未确认"));
  const pending=JSON.parse(createPrivateStorage("guest").getItem(`research-draft-v1:review:${r.id}`)!).value.pending;
  expect(screen.queryByText("复核已保存")).not.toBeInTheDocument(); fail.mockRestore(); cleanup(); mount(); await ready(); await openReview(r.id); await submitReview();
  expect(Object.values(state().research_review_events!)).toEqual([pending]); expect(createPrivateStorage("guest").getItem(`research-draft-v1:review:${r.id}`)).toBeNull();
 });
 it("isolates review drafts across guest, A and B even for the same record ID", async()=>{
  const r=record();seed([r]);mount();await ready();await openReview(r.id);fillReview("Guest draft");cleanup();
  user={id:"alice",email:"alice@example.test"};remote=seed([r],privateScope("alice"));mount();await ready("alice");await openReview(r.id);expect(screen.getByLabelText("本次复核理由")).toHaveValue("");fillReview("Alice draft");cleanup();
  user={id:"bob",email:"bob@example.test"};remote=seed([r],privateScope("bob"));mount();await ready("bob");await openReview(r.id);expect(screen.getByLabelText("本次复核理由")).toHaveValue("");fillReview("Bob draft");
  for(const [scope,expected] of [["guest","Guest draft"],[privateScope("alice"),"Alice draft"],[privateScope("bob"),"Bob draft"]]) expect(JSON.parse(createPrivateStorage(scope).getItem(`research-draft-v1:review:${r.id}`)!).value.fields.reason).toBe(expected);
 });
 it("keeps separate edit drafts for two judgments of the same asset", async()=>{
  const a=record("First"),b=record("Second");seed([a,b]);mount();await ready();await waitFor(()=>expect(screen.getAllByRole("button",{name:"编辑判断"})).toHaveLength(2));
  const cards=screen.getAllByRole("article");fireEvent.click(within(cards[0]).getByRole("button",{name:"编辑判断"}));draftText("Edit one");fireEvent.click(screen.getByRole("button",{name:"关闭"}));
  fireEvent.click(within(cards[1]).getByRole("button",{name:"编辑判断"}));draftText("Edit two");fireEvent.click(screen.getByRole("button",{name:"关闭"}));
  fireEvent.click(within(cards[0]).getByRole("button",{name:"编辑判断"}));expect(screen.getByLabelText("判断理由")).toHaveValue("Edit one");
 });
 it("warns when automatic draft persistence fails without claiming a saved draft", async()=>{
  mount();await ready();openRecord();vi.spyOn(localStorage,"setItem").mockImplementation(()=>{throw Error("quota")});draftText("Not persisted");
  expect(screen.getByRole("alert")).toHaveTextContent("草稿未能保存");expect(screen.getByLabelText("判断理由")).toHaveValue("Not persisted");
 });
});

describe("Research entry and follow-through",()=>{
 it("offers AAOG single-asset saving without data and rejects mismatched snapshot symbols",async()=>{
  const aaog={...asset,symbol:"AAOG",name:"AAOI ETF",asset_type:"etf" as const};
  render(<Providers><SingleAssetResearchEntry symbols={["AAOG"]} active="AAOG" assets={[aaog]} history={{symbol:"NVDA",data_as_of:"2026-10-12",snapshot:{latest_price:100}} as never} forecast={{symbol:"NVDA",signal:"Up"} as never}/></Providers>);
  await waitFor(()=>expect(api.getCurrentUser).toHaveBeenCalled());openRecord();draftText("ETF view");fireEvent.change(screen.getByLabelText("主要风险"),{target:{value:"Leverage"}});fireEvent.click(screen.getByRole("button",{name:"保存判断"}));
  await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const saved=JSON.parse(createPrivateStorage("guest").getItem("orivane-user-state")!);const r=Object.values(saved.research_records)[0] as ResearchRecord;
  expect(r.symbol).toBe("AAOG");expect(r.snapshot).toEqual({reference_price:null,market_data_as_of:null,forecast:null});
 });
 it.each([
  {symbols:["NVDA","AAOG"],active:"NVDA",assets:[asset]},
  {symbols:["AAOG"],active:"AAOG",assets:[asset]},
  {symbols:["NVDA"],active:"NVDA",assets:[{...asset,name:""}]},
 ])("hides potentially ambiguous selection %#",async selection=>{
  render(<Providers><SingleAssetResearchEntry {...selection}/></Providers>);await waitFor(()=>expect(api.getCurrentUser).toHaveBeenCalled());expect(screen.queryByRole("button",{name:"保存研究判断"})).not.toBeInTheDocument();
 });
 it("keeps completion feedback when a queue item disappears, links the exact event and restores recent history",async()=>{
  const r=record();seed([r]);mount(true);await ready();const queue=screen.getByRole("region",{name:"今天需要处理"});
  fireEvent.click(await within(queue).findByRole("button",{name:`执行复核 NVDA ${r.id}`}));fillReview();await submitReview();
  expect(within(queue).getByText("复核已保存")).toBeInTheDocument();expect(within(queue).getByText("当前没有待处理的复核")).toBeInTheDocument();expect(within(queue).queryByText(/先研究一只资产|已检查的资产/)).not.toBeInTheDocument();
  const event=Object.values(state().research_review_events!)[0];const link=within(queue).getByRole("link",{name:"查看本次复核记录"});expect(link).toHaveAttribute("href",`#research-review-${event.id}`);fireEvent.click(link);
  expect(document.getElementById(`research-review-${event.id}`)?.closest("details")).toHaveAttribute("open");
  cleanup();mount(true);await ready();await waitFor(()=>expect(screen.getByText(/最近完成的复核/)).toBeInTheDocument());expect(screen.getByRole("link",{name:"查看本次复核记录"})).toHaveAttribute("href",`#research-review-${event.id}`);
 });
 it("separates current reasons from original judgment, and keeps direction visible after archive",async()=>{
  const r=record();seed([r]);mount();await ready();await openReview(r.id);fillReview("New bearish evidence");fireEvent.change(screen.getByLabelText("复核结论"),{target:{value:"adjust"}});fireEvent.change(screen.getByLabelText("调整后的方向"),{target:{value:"bearish"}});await submitReview();
  const current=screen.getByLabelText("当前判断");expect(current).toHaveTextContent("New bearish evidence");expect(current).not.toHaveTextContent("Original reason");expect(screen.getByText("原始理由").nextElementSibling).toHaveTextContent("Original reason");
  expect(state().research_records![r.id]).toEqual(r);await openReview(r.id);fillReview("Stop tracking");fireEvent.change(screen.getByLabelText("复核结论"),{target:{value:"archive"}});await submitReview();
  expect(screen.getByText("已归档")).toBeInTheDocument();expect(screen.getByText("看空",{selector:"header span"})).toBeInTheDocument();expect(state().research_records![r.id]).toEqual(r);
 });
 it("does not invent original judgment for a legacy record",async()=>{
  const r=record();delete r.initial_judgment;seed([r]);mount();await ready();expect(await screen.findByText(/旧记录未保存初始版本，无法还原最初判断/)).toBeInTheDocument();expect(screen.queryByText("原始理由")).not.toBeInTheDocument();
 });
});
