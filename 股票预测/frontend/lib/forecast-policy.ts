import type { Forecast } from "./types";

// Mirrors CLOUD_FORECAST_POLICY_VERSION in netlify/functions/_shared/forecast-eligibility.ts
// (kept separate so the browser bundle does not pull in the trading calendar); a test keeps
// them equal. Request paths carry it, so browser caches (localStorage and IndexedDB, up to
// 24h stale) and edge caches can never serve forecasts or evidence from another policy.
export const FORECAST_POLICY_VERSION = "cloud-forecast-policy-v1";

export function policyPath(path: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}policy=${FORECAST_POLICY_VERSION}`;
}

// A forecast from another (or no) policy is shown, but never as actionable.
export function withCurrentPolicyGuard(forecast: Forecast): Forecast {
  if (!forecast || forecast.policy_version === FORECAST_POLICY_VERSION) return forecast;
  return { ...forecast, signal: "Observe", action: forecast.action ? { ...forecast.action, actionable: false } : forecast.action };
}
