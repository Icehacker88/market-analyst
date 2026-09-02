import { describe, expect, it } from "vitest";
import { applyUserStatePatch, DEFAULT_NOTIFICATION_PREFERENCES, DEFAULT_USER_STATE, hasStatePatch, normalizeUserState, statePatch } from "./user-state";

describe("modular user state synchronization", () => {
  it("fills new settings for legacy cloud records", () => {
    const state = normalizeUserState({ watchlists: [{ id: "main", name: "Main", symbols: ["AAPL"] }] });
    expect(state.watchlists[0].symbols).toEqual(["AAPL"]);
    expect(state.notification_preferences).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(state.ai_chats).toEqual({});
  });

  it("sends only changed modules and ignores server metadata", () => {
    const next = normalizeUserState({
      ...DEFAULT_USER_STATE,
      daily_summary_enabled: false,
      updated_at: "2026-09-01T00:00:00.000Z",
      state_revision: 4,
    });
    const patch = statePatch(DEFAULT_USER_STATE, next);
    expect(patch).toEqual({ daily_summary_enabled: false });
    expect(hasStatePatch(patch)).toBe(true);
    expect(hasStatePatch({ updated_at: "now", state_revision: 5 })).toBe(false);
  });

  it("merges an offline patch without dropping other modules", () => {
    const current = normalizeUserState({ portfolios: [{ id: "p", name: "Core", currency: "USD", holdings: [] }] });
    const merged = applyUserStatePatch(current, { preferred_language: "en" });
    expect(merged.preferred_language).toBe("en");
    expect(merged.portfolios).toHaveLength(1);
  });
});
