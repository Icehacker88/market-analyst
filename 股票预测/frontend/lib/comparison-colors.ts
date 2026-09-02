export const COMPARISON_COLORS = ["#11877d", "#d84f4a", "#d08a28", "#6f65b5", "#2f6fb0"] as const;

export function comparisonColor(index: number): string {
  return COMPARISON_COLORS[index % COMPARISON_COLORS.length];
}

const LINE_PATTERNS = [undefined, "9 4", "3 3", "11 3 2 3", "1 5"] as const;

export function comparisonDasharray(index: number): string | undefined {
  return LINE_PATTERNS[index % LINE_PATTERNS.length];
}
