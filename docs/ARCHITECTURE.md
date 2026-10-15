# Repository architecture and operational boundaries

Last reconciled: 2026-10-15. This document reflects the remote `main` snapshot `f28da7709353adbc716932af119ddd210dc1b400` and local read-only project materials dated through 2026-10-01. Verify live deployments and Actions before any release decision.

## Repository areas

| Area | Purpose | Main entry points |
| --- | --- | --- |
| Python market analysis | Data loading, features, models, evaluation, frozen prediction ledger, daily report and email | `股票预测/src/`, `股票预测/main.py` |
| Python service | FastAPI endpoints and adapters for local Python analysis | `股票预测/backend/app/` |
| Orivane web app | Next.js static frontend and Cloudflare Pages API/Worker source | `股票预测/frontend/` |
| Daily report automation | Scheduled market-session-gated report, ledger persistence, email, artifact | `.github/workflows/daily-market-report.yml` |
| Official Kronos automation | Scheduled/manual model batch using GitHub OIDC and site endpoint | `.github/workflows/kronos-daily.yml`, `股票预测/scripts/run_official_kronos_batch.py` |
| Root Netlify build | Separate build/API configuration with base `股票预测/frontend` | `netlify.toml` |

The root Python pipeline, local FastAPI service, Cloudflare Worker API, and official Kronos workflow are related but separate execution paths. Do not assume one test or deployment covers all of them.

## Deployment configuration

- The remote root `netlify.toml` currently sets the build base to `股票预测/frontend`, runs `npm run build`, publishes `out`, points functions to `股票预测/frontend/netlify/functions`, and routes `/api/*` to the Netlify function. This is configuration evidence only; it does not establish the active production provider or deployment target.
- The Orivane frontend source also includes its own `股票预测/frontend/netlify.toml`, Cloudflare Worker generator and Wrangler configuration. The maintained `netlify/functions/api.mts` is an API source file and generated Worker output must be refreshed by the project script.
- The public Orivane URL in the Python README is `https://orivane-market-intelligence.pages.dev/`; deployment status and the live code behind it must be rechecked before claiming current release state.
- Never run deployment commands, scheduled jobs, email delivery, optimizer jobs, or production data/configuration writes without explicit user authorization naming the target and action.

## Automation contracts to preserve

### Daily Market Report

The workflow schedules multiple Malaysia-morning retries, deduplicates against a same-day successful run with a non-expired `daily-market-report` artifact, checks for a newly completed U.S. session, installs dependencies and runs Python unit tests only when a report is due, generates the report with external GPT analysis disabled, verifies ledger outputs and email status, commits `股票预测/data/history/prediction_ledger.csv` to the workflow branch, then uploads the report artifact. Its workflow permissions currently include `actions: read` and `contents: write`; concurrency is serialized. Changes to timing, dedupe, market-session gating, email, write permissions, ledger, or artifact name/path need explicit task scope and review.

### Official Kronos Daily Forecast

The workflow runs on weekday schedule or manual dispatch, installs a pinned upstream Kronos revision, obtains a GitHub OIDC token for audience `orivane-kronos`, calls the public Orivane site, and uploads an official forecast artifact. Its identity, site endpoint, and artifact contract are operational interfaces. Do not manually trigger it without explicit authorization.

## Data and safety boundaries

- Treat `股票预测/data/history/prediction_ledger.csv` as versioned prediction history with workflow writes. Avoid concurrent edits; coordinate with Actions activity and rebase task branches before merge.
- Keep API keys, SMTP/OAuth credentials, `.env` files, account/session data, private KV contents and local QA fixtures out of Git and logs.
- Keep Preview identities and all KV namespaces separate from Production. A build, test, merge, or Preview result does not prove Production behavior.
- Prediction/backtest output is informational. Preserve actual-vs-forecast and backtest-vs-frozen-record distinctions and the project's investment-risk disclosures.
