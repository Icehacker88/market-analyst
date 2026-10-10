import type { MarketSnapshot, ReadOnlySnapshotMetadata } from "../../lib/types";

/** Storage metadata fixture, separate from client receipt time. */
export function withReadOnlyMetadata(item: MarketSnapshot, now = Date.now()): MarketSnapshot {
  const source = (kind: "history" | "forecast"): ReadOnlySnapshotMetadata["history"] => ({
    source: kind === "history" ? "history_cache" : "frozen_forecast",
    status: item[kind] ? "available" : "unavailable",
    data_as_of: item[kind]?.data_as_of || null,
    stored_at: kind === "history" ? new Date(now - 60_000).toISOString() : null,
    generated_at: kind === "forecast" ? new Date(now - 60_000).toISOString() : null,
    expires_at: item[kind] ? now + 29 * 60_000 : null,
  });
  return { ...item, read_only: { version: 1, queried_at: new Date(now).toISOString(), query_status: "complete", history: source("history"), forecast: source("forecast") } };
}
