import type { Config } from "@netlify/functions";
import { stateStore, symbolsFromState, type StoredUserState } from "./_shared/market-email.ts";

const DEFAULT_SYMBOL_LIMIT = 20;

function siteUrl(): string {
  return process.env.URL || "https://orivane-market-intelligence.netlify.app";
}

async function favoriteSymbols(): Promise<string[]> {
  const store = stateStore();
  const { blobs } = await store.list({ prefix: "users/" });
  const counts = new Map<string, number>();
  for (const blob of blobs.slice(0, 500)) {
    const state = await store.get(blob.key, { type: "json" }) as StoredUserState | null;
    for (const symbol of symbolsFromState(state || {})) counts.set(symbol, (counts.get(symbol) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([symbol]) => symbol)
    .slice(0, Number(process.env.ORIVANE_FAVORITE_OPTIMIZER_LIMIT || DEFAULT_SYMBOL_LIMIT));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async () => {
  const endpoint = `${siteUrl().replace(/\/$/, "")}/api/forecast/run`;
  for (const symbol of await favoriteSymbols()) {
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol }),
      signal: AbortSignal.timeout(20000),
    }).catch(() => undefined);
    await wait(300);
  }
};

// Refresh after the US session is normally complete.
export const config: Config = { schedule: "30 22 * * 1-5" };
