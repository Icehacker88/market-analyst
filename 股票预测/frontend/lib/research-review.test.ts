import { describe, expect, it } from "vitest";
import { nextReviewDate, reviewIsDue, reviewReasonLabel, triggerPriceFor } from "./research-review";
import type { Forecast, ResearchReview } from "./types";

const forecast = { key_levels: { breakout: 110, resistance: 108, support: 94, invalidation: 90 } } as Forecast;

describe("research review helpers", () => {
  it("moves weekend next-session reviews to Monday", () => {
    expect(nextReviewDate("next_session", new Date("2026-08-14T08:00:00Z"))).toContain("2026-08-17");
  });

  it("selects the relevant forecast level", () => {
    expect(triggerPriceFor("breakout", forecast)).toBe(110);
    expect(triggerPriceFor("pullback", forecast)).toBe(94);
    expect(triggerPriceFor("invalidation", forecast)).toBe(90);
    expect(triggerPriceFor("next_session", forecast)).toBeNull();
  });

  it("localizes and detects due reviews", () => {
    const review = { due_at: "2026-08-14T00:00:00Z" } as ResearchReview;
    expect(reviewReasonLabel("pullback", "zh")).toBe("回踩支撑时复核");
    expect(reviewIsDue(review, new Date("2026-08-15T00:00:00Z"))).toBe(true);
  });
});
