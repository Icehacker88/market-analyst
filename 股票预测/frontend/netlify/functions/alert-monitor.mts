import type { Config } from "@netlify/functions";
import { env, quote, sendEmail, stateStore, type StoredUserState } from "./_shared/market-email.ts";

export default async () => {
  if (!env("RESEND_API_KEY")) return;
  const store = stateStore();
  const { blobs } = await store.list({ prefix: "users/" });
  for (const blob of blobs.slice(0, 100)) {
    const state = await store.get(blob.key, { type: "json" }) as StoredUserState | null;
    if (!state?.account_email) continue;
    const alerts = (state.alerts || []).filter((alert) => alert.enabled && ["above", "below", "change"].includes(alert.type));
    const quotes = await Promise.allSettled([...new Set(alerts.map((alert) => alert.symbol))].map(quote));
    const bySymbol = new Map(quotes.filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof quote>>> => item.status === "fulfilled").map((item) => [item.value.symbol, item.value]));
    const now = new Date();
    const triggered = alerts.filter((alert) => {
      const market = bySymbol.get(alert.symbol); const threshold = Number(alert.value);
      if (!market || !Number.isFinite(threshold)) return false;
      const last = state.last_notified?.[alert.id];
      if (last && now.getTime() - new Date(last).getTime() < 86400000) return false;
      return alert.type === "above" ? market.price >= threshold : alert.type === "below" ? market.price <= threshold : Math.abs(market.change) >= threshold / 100;
    });
    if (!triggered.length) continue;
    const zh = state.preferred_language !== "en";
    const rows = triggered.map((alert) => { const market = bySymbol.get(alert.symbol)!; return `<tr><td>${alert.symbol}</td><td>${market.price.toFixed(2)}</td><td>${(market.change * 100).toFixed(2)}%</td><td>${alert.type}</td><td>${String(alert.value)}</td></tr>`; }).join("");
    const sent = await sendEmail(state.account_email, zh ? "Orivane 市场提醒" : "Orivane market alert", `<h2>${zh ? "市场提醒已触发" : "Market alert triggered"}</h2><table><tr><th>Symbol</th><th>Price</th><th>1D</th><th>Type</th><th>Value</th></tr>${rows}</table>`);
    if (sent) {
      state.last_notified = { ...(state.last_notified || {}), ...Object.fromEntries(triggered.map((alert) => [alert.id, now.toISOString()])) };
      state.alert_history = [
        ...triggered.map((alert) => {
          const market = bySymbol.get(alert.symbol)!;
          return { id: alert.id, symbol: alert.symbol, type: alert.type, value: alert.value, price: market.price, change: market.change, triggered_at: now.toISOString() };
        }),
        ...(state.alert_history || []),
      ].slice(0, 50);
      await store.setJSON(blob.key, state);
    }
  }
};

export const config: Config = { schedule: "0 * * * *" };
