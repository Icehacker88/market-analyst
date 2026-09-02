import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const catalogSource = await readFile(path.join(root, "lib/asset-catalog.ts"), "utf8");
const outputPath = path.join(root, "lib/seo-forecast-snapshots.json");
const rows = [...catalogSource.matchAll(/^\s*\["([^"]+)",\s*"([^"]+)"/gm)].map((match) => ({ symbol: match[1], slug: match[2] }));
let existing = {};
try { existing = JSON.parse(await readFile(outputPath, "utf8")); } catch { existing = {}; }

if (process.env.ORIVANE_SKIP_SEO_REFRESH === "1") process.exit(0);
const apiBase = (process.env.ORIVANE_SEO_API_BASE || "https://orivane-market-intelligence.pages.dev").replace(/\/$/, "");
const snapshots = { ...existing };
const refreshed = new Set();
const failed = new Map();
let cursor = 0;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchSnapshot(row) {
  let lastError = "unknown error";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${apiBase}/api/forecast/latest?symbol=${encodeURIComponent(row.symbol)}`, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const forecast = (await response.json()).data;
      if (!forecast?.data_as_of) throw new Error("missing data_as_of");
      return {
        symbol: row.symbol,
        data_as_of: forecast.data_as_of,
        generated_at: forecast.generated_at,
        signal: forecast.signal,
        confidence_score: forecast.confidence_score ?? null,
        forecast_1d_return: forecast.forecast_1d_return ?? null,
        forecast_5d_return: forecast.forecast_5d_return ?? null,
        forecast_10d_return: forecast.forecast_10d_return ?? null,
        forecast_1m_return: forecast.forecast_1m_return ?? null,
        horizon_models: forecast.horizon_models || [],
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 3) await sleep(300 * (2 ** (attempt - 1)));
    }
  }
  failed.set(row.symbol, lastError);
  return null;
}

const workers = Array.from({ length: 6 }, async () => {
  while (cursor < rows.length) {
    const row = rows[cursor++];
    const snapshot = await fetchSnapshot(row);
    if (snapshot) {
      snapshots[row.slug] = snapshot;
      refreshed.add(row.slug);
    }
  }
});
await Promise.all(workers);

const missing = rows.filter((row) => !snapshots[row.slug]);
if (missing.length) {
  const details = missing.map((row) => `${row.symbol} (${failed.get(row.symbol) || "no snapshot"})`).join(", ");
  throw new Error(`SEO forecast coverage incomplete: ${details}`);
}

await writeFile(outputPath, `${JSON.stringify(snapshots, null, 2)}\n`);
console.log(`Prepared SEO forecast snapshots for ${Object.keys(snapshots).length}/${rows.length} assets (${refreshed.size} refreshed, ${rows.length - refreshed.size} retained).`);
