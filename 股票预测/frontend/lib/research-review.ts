import type { Forecast, ResearchReview } from "./types";

export const reviewReasonOrder: ResearchReview["reason"][] = ["next_session", "breakout", "pullback", "invalidation"];

export function nextReviewDate(reason: ResearchReview["reason"], now = new Date()): string {
  const due = new Date(now);
  due.setHours(9, 0, 0, 0);
  if (reason === "next_session") due.setDate(due.getDate() + 1);
  else due.setDate(due.getDate() + 7);
  while (due.getDay() === 0 || due.getDay() === 6) due.setDate(due.getDate() + 1);
  return due.toISOString();
}

export function triggerPriceFor(reason: ResearchReview["reason"], forecast: Forecast): number | null {
  if (reason === "breakout") return finite(forecast.key_levels?.breakout ?? forecast.key_levels?.resistance);
  if (reason === "pullback") return finite(forecast.key_levels?.support);
  if (reason === "invalidation") return finite(forecast.key_levels?.invalidation);
  return null;
}

export function reviewReasonLabel(reason: ResearchReview["reason"], language: "zh" | "en"): string {
  const zh = language === "zh";
  const labels: Record<ResearchReview["reason"], [string, string]> = {
    next_session: ["下一交易日复核", "Review next session"],
    breakout: ["突破关键位时复核", "Review on breakout"],
    pullback: ["回踩支撑时复核", "Review on pullback"],
    invalidation: ["触及失效位时复核", "Review at invalidation"],
  };
  return labels[reason][zh ? 0 : 1];
}

export function reviewIsDue(review: ResearchReview, now = new Date()): boolean {
  return new Date(review.due_at).getTime() <= now.getTime();
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
