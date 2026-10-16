# Repository architecture and operational boundaries

2026-10-16 handoff: the architecture below describes the older main baseline. Latest product/auth code is now available on the separate branches linked in [PROJECT_STATUS.md](PROJECT_STATUS.md); their Preview configuration and newer research features are not merged into this documentation branch.

Last reconciled: 2026-10-15. This document reflects the remote `main` snapshot `f28da7709353adbc716932af119ddd210dc1b400` and local read-only project materials dated through 2026-10-01. The user confirmed Cloudflare Pages as the current host on 2026-10-15. Verify live deployment revisions and Actions before any release decision.

## Repository areas

| Area | Purpose | Main entry points |
| --- | --- | --- |
| Python market analysis | Data loading, features, models, evaluation, frozen prediction ledger, daily report and email | `股票预测/src/`, `股票预测/main.py` |
| Python service | FastAPI endpoints and adapters for local Python analysis | `股票预测/backend/app/` |
| Orivane web app | Next.js static frontend and Cloudflare Pages API/Worker source | `股票预测/frontend/` |
| Daily report automation | Scheduled market-session-gated report, ledger persistence, email, artifact | `.github/workflows/daily-market-report.yml` |
| Official Kronos automation | Scheduled/manual model batch using GitHub OIDC and site endpoint | `.github/workflows/kronos-daily.yml`, `股票预测/scripts/run_official_kronos_batch.py` |
| Legacy Netlify configuration | Retained configuration; not the current hosting platform | `netlify.toml`, `股票预测/frontend/netlify.toml` |

The root Python pipeline, local FastAPI service, Cloudflare Worker API, and official Kronos workflow are related but separate execution paths. Do not assume one test or deployment covers all of them.

## Deployment configuration

**Current host: Cloudflare Pages**, confirmed directly by the user on 2026-10-15. The frontend uses static output in `out`; the cloud API is generated for Pages Functions/Workers. Wrangler configuration and Cloudflare deployment metadata are the hosting references. This confirmation does not verify the currently deployed revision or live environment bindings.

- The remote root `netlify.toml` currently sets the build base to `股票预测/frontend`, runs `npm run build`, publishes `out`, points functions to `股票预测/frontend/netlify/functions`, and routes `/api/*` to the Netlify function. This is retained legacy configuration. It does not describe a separate active Python deployment, and must not be used to initiate a Netlify deployment.
- The Orivane frontend source also includes its own `股票预测/frontend/netlify.toml`, Cloudflare Worker generator and Wrangler configuration. The maintained `netlify/functions/api.mts` is still the API source consumed by `scripts/generate-cloudflare-worker.mjs`, which writes `functions/api/[[path]].ts`. Preserve this source and its dependencies; the Netlify name is not evidence that it is unused. Generated Worker output must be refreshed by the project script.
- The public Orivane URL in the Python README is `https://orivane-market-intelligence.pages.dev/`; deployment status and the live code behind it must be rechecked before claiming current release state.
- Never run deployment commands, scheduled jobs, email delivery, optimizer jobs, or production data/configuration writes without explicit user authorization naming the target and action.

### Branch-specific Preview caution

In the inspected remote baseline, `wrangler.toml` has no `env.preview` section and `preview:cloudflare` does not select an isolated Preview environment. Separate local branches contain later isolation work, but that work is not included in this documentation branch. Inspect actual bindings and establish explicit Preview isolation before running Wrangler against remote resources. Historical reports cannot substitute for checking the current branch and target.

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
