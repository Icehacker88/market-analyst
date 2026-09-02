import { canonicalSymbol } from "./assets";

export const MAX_ASSETS = 5;

export function parseSymbols(value: string | null): string[] {
  const symbols = (value || "")
    .split(",")
    .map(canonicalSymbol)
    .filter(Boolean);
  return [...new Set(symbols)].slice(0, MAX_ASSETS);
}

export function addSymbol(symbols: string[], symbol: string): { symbols: string[]; limited: boolean } {
  const normalized = canonicalSymbol(symbol);
  if (symbols.includes(normalized)) return { symbols, limited: false };
  if (symbols.length >= MAX_ASSETS) return { symbols, limited: true };
  return { symbols: [...symbols, normalized], limited: false };
}

export function removeSymbol(symbols: string[], symbol: string): string[] {
  return symbols.filter((item) => item !== canonicalSymbol(symbol));
}

export function symbolsQuery(symbols: string[]): string {
  return symbols.join(",");
}

export function startForRange(range: string, now = new Date()): string {
  const start = new Date(now);
  if (range === "YTD") {
    start.setMonth(0, 1);
    return start.toISOString().slice(0, 10);
  }
  if (range === "MAX") return "1900-01-01";
  const days: Record<string, number> = { "1D": 7, "5D": 14, "1M": 31, "3M": 93, "6M": 186, "1Y": 366, "3Y": 1096, "5Y": 1827, "10Y": 3653 };
  start.setDate(start.getDate() - (days[range] || days["1Y"]));
  return start.toISOString().slice(0, 10);
}
