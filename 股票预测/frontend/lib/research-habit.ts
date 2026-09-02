export const RESEARCH_HABIT_STORAGE_KEY = "orivane-research-habit-v1";

export type ResearchHabit = {
  visit_dates: string[];
  completed_review_dates: string[];
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function dateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function readResearchHabit(storage: Pick<Storage, "getItem">): ResearchHabit {
  try {
    const stored = JSON.parse(storage.getItem(RESEARCH_HABIT_STORAGE_KEY) || "{}") as Partial<ResearchHabit>;
    return {
      visit_dates: uniqueDates(stored.visit_dates),
      completed_review_dates: uniqueDates(stored.completed_review_dates),
    };
  } catch {
    return { visit_dates: [], completed_review_dates: [] };
  }
}

export function recordResearchVisit(storage: StorageLike, now = new Date()): ResearchHabit {
  return writeResearchHabit(storage, "visit_dates", now);
}

export function recordReviewCompletion(storage: StorageLike, now = new Date()): ResearchHabit {
  return writeResearchHabit(storage, "completed_review_dates", now);
}

export function weeklyResearchStats(habit: ResearchHabit, now = new Date()): { visitDays: number; completedReviews: number } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  const startKey = dateKey(start);
  const endKey = dateKey(now);
  const inWeek = (value: string) => value >= startKey && value <= endKey;
  return {
    visitDays: habit.visit_dates.filter(inWeek).length,
    completedReviews: habit.completed_review_dates.filter(inWeek).length,
  };
}

function writeResearchHabit(storage: StorageLike, field: keyof ResearchHabit, now: Date): ResearchHabit {
  const current = readResearchHabit(storage);
  const next = { ...current, [field]: uniqueDates([...current[field], dateKey(now)]).slice(-90) };
  storage.setItem(RESEARCH_HABIT_STORAGE_KEY, JSON.stringify(next));
  return next;
}

function uniqueDates(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)))].sort();
}
