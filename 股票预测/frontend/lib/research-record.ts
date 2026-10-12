import type { Asset, Forecast, History, ResearchRecord, UserState } from "./types";

export type ResearchDraft = Pick<ResearchRecord, "direction" | "reason" | "risks" | "invalidation" | "review_date">;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
export function captureResearchSnapshot(symbol: string, history?: History, forecast?: Forecast): ResearchRecord["snapshot"] {
  const h = history?.symbol === symbol ? history : undefined;
  const f = forecast?.symbol === symbol ? forecast : undefined;
  const price = number(h?.snapshot?.latest_price);
  return {
    reference_price: price !== null && price > 0 ? price : null,
    market_data_as_of: text(h?.data_as_of),
    forecast: f ? {
      signal: ["Up", "Down", "Observe"].includes(f.signal) ? f.signal : null,
      return_1d: number(f.forecast_1d_return), return_5d: number(f.forecast_5d_return), return_1m: number(f.forecast_1m_return),
      data_as_of: text(f.data_as_of), generated_at: text(f.generated_at), model: text(f.best_model),
      // The current Forecast contract does not provide an overall model version.
      model_version: null, optimization_version: text(f.self_optimization?.version),
    } : null,
  };
}
export function makeResearchRecord(asset: Asset, draft: ResearchDraft, history?: History, forecast?: Forecast): ResearchRecord {
  const now = new Date().toISOString();
  return { ...draft, version: 1, id: crypto.randomUUID(), symbol: asset.symbol, asset_name: asset.name_zh || asset.name,
    currency: asset.currency || null, created_at: now, updated_at: now, snapshot: captureResearchSnapshot(asset.symbol, history, forecast) };
}
export function validResearchDraft(draft: ResearchDraft): boolean {
  return typeof draft.reason === "string" && typeof draft.risks === "string"
    && (draft.invalidation === null || typeof draft.invalidation === "string")
    && (draft.review_date === null || typeof draft.review_date === "string")
    && ["bullish", "bearish", "neutral"].includes(draft.direction) && Boolean(draft.reason.trim()) && Boolean(draft.risks.trim())
    && draft.reason.length <= 3000 && draft.risks.length <= 2000 && (draft.invalidation?.length || 0) <= 1000
    && (!draft.review_date || (/^\d{4}-\d{2}-\d{2}$/.test(draft.review_date) && Number.isFinite(Date.parse(draft.review_date)) && new Date(draft.review_date).toISOString().slice(0, 10) === draft.review_date));
}
export function upsertResearchRecord(state: UserState, record: ResearchRecord): UserState {
  if (!validResearchDraft(record)) throw new Error("Invalid research record");
  const previous = state.research_records?.[record.id];
  const saved = previous ? { ...previous, direction: record.direction, reason: record.reason.trim(), risks: record.risks.trim(),
    invalidation: record.invalidation?.trim() || null, review_date: record.review_date || null, updated_at: new Date().toISOString() }
    : { ...record, reason: record.reason.trim(), risks: record.risks.trim(), invalidation: record.invalidation?.trim() || null };
  const records = { ...state.research_records, [saved.id]: saved };
  if (JSON.stringify({ research_records: records }).length > 240000) throw new Error("Research storage limit reached");
  return { ...state, research_records: records };
}
export function researchRecords(state: UserState): ResearchRecord[] {
  return Object.values(state.research_records || {}).filter((r) => r && r.version === 1 && r.id && r.symbol && r.snapshot && validResearchDraft(r))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
