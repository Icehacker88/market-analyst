import { describe, expect, it } from "vitest";
import { readResearchHabit, recordResearchVisit, recordReviewCompletion, weeklyResearchStats } from "./research-habit";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } as Pick<Storage, "getItem" | "setItem">;
}

describe("research habit", () => {
  it("records no more than one visit per calendar day", () => {
    const store = storage();
    recordResearchVisit(store, new Date(2026, 7, 18, 9));
    recordResearchVisit(store, new Date(2026, 7, 18, 18));
    expect(readResearchHabit(store).visit_dates).toEqual(["2026-08-18"]);
  });

  it("counts visits and completed reviews in the current Monday-based week", () => {
    const store = storage();
    recordResearchVisit(store, new Date(2026, 7, 17));
    recordResearchVisit(store, new Date(2026, 7, 20));
    recordReviewCompletion(store, new Date(2026, 7, 20));
    recordResearchVisit(store, new Date(2026, 7, 16));
    expect(weeklyResearchStats(readResearchHabit(store), new Date(2026, 7, 22))).toEqual({ visitDays: 2, completedReviews: 1 });
  });
});
