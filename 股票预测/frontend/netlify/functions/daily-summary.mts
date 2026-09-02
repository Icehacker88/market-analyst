import type { Config } from "@netlify/functions";
import { env, quote, sendEmail, stateStore, symbolsFromState, type StoredUserState } from "./_shared/market-email.ts";

export default async () => {
  if (!env("RESEND_API_KEY")) return;
  const store = stateStore();
  const { blobs } = await store.list({ prefix: "users/" });
  for (const blob of blobs.slice(0, 100)) {
    const state = await store.get(blob.key, { type: "json" }) as StoredUserState | null;
    if (!state?.account_email) continue;
    if (state.daily_summary_enabled === false) continue;
    const settled = await Promise.allSettled(symbolsFromState(state).map(quote));
    const quotes = settled.filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof quote>>> => item.status === "fulfilled").map((item) => item.value).sort((a, b) => b.change - a.change);
    if (!quotes.length) continue;
    const zh = state.preferred_language !== "en";
    const rows = quotes.map((item) => `<tr><td>${item.symbol}</td><td>${item.price.toFixed(2)}</td><td style="color:${item.change >= 0 ? "#13856f" : "#df5148"}">${item.change >= 0 ? "+" : ""}${(item.change * 100).toFixed(2)}%</td></tr>`).join("");
    await sendEmail(state.account_email, zh ? "Orivane 每日观察列表" : "Orivane daily watchlist", `<h2>${zh ? "每日市场摘要" : "Daily market summary"}</h2><table><tr><th>Symbol</th><th>Price</th><th>1D</th></tr>${rows}</table>`);
  }
};

// 00:00 UTC equals 08:00 in Malaysia.
export const config: Config = { schedule: "0 0 * * *" };
