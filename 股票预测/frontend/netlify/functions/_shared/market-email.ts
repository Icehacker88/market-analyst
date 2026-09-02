import { getStore } from "@netlify/blobs";

declare const Netlify: { env: { get: (name: string) => string | undefined } };

type Alert = { id: string; symbol: string; type: "above" | "below" | "change" | "signal"; value: number | string; enabled: boolean };
type AlertHistory = { id: string; symbol: string; type: Alert["type"]; value: number | string; price: number; change: number; triggered_at: string };
export type StoredUserState = {
  account_email?: string;
  preferred_language?: "zh" | "en";
  watchlists?: Array<{ symbols?: string[] }>;
  alerts?: Alert[];
  alert_history?: AlertHistory[];
  portfolios?: Array<{ holdings?: Array<{ symbol: string }> }>;
  daily_summary_enabled?: boolean;
  last_notified?: Record<string, string>;
  [key: string]: unknown;
};

export function stateStore() { return getStore({ name: "orivane-user-state", consistency: "strong" }); }
export function env(name: string) { return Netlify.env.get(name); }

export async function quote(symbol: string): Promise<{ symbol: string; price: number; change: number }> {
  const yahooSymbol = symbol.endsWith(".SH") ? `${symbol.slice(0, -3)}.SS` : symbol;
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=5d&interval=1d`, { headers: { "user-agent": "Mozilla/5.0 Orivane/1.0" }, signal: AbortSignal.timeout(6000) });
  const payload = await response.json() as { chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } };
  const prices = (payload.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter((value): value is number => typeof value === "number");
  if (prices.length < 2) throw new Error(`No quote for ${symbol}`);
  return { symbol, price: prices.at(-1)!, change: prices.at(-1)! / prices.at(-2)! - 1 };
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = env("RESEND_API_KEY");
  const from = env("ORIVANE_EMAIL_FROM");
  if (!apiKey || !from) return false;
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, html }) });
  return response.ok;
}

export function symbolsFromState(state: StoredUserState): string[] {
  return [...new Set([...(state.watchlists || []).flatMap((list) => list.symbols || []), ...(state.portfolios || []).flatMap((portfolio) => (portfolio.holdings || []).map((holding) => holding.symbol))])].slice(0, 20);
}
