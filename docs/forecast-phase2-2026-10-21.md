# FREEZE-DEDUPE-INTRADAY / ARIMA validation phase 2

Owner: Codex. [PR #25](https://github.com/Icehacker88/market-analyst/pull/25). Status: implementation in review; cross-review by Claude Code pending.

- Base: fresh `origin/main` `5f124e868bb4617f1512608ecef675dec293d000` (PR #24).
- Branch: `codex/freeze-arima-phase2-20261020`; worktree: `/workspace/freeze-arima-phase2`. Started October 20; handoff October 21, Asia/Kuala_Lumpur.
- Original `/workspace/market-analyst` checkout was clean and remains untouched. No open PRs at initial read; latest PR Checks and Daily Market Report were successful. GitHub deployment entries inspected were ledger jobs, not Cloudflare deployment evidence. PR #24 records Production `78128767`; this task has not independently revalidated the hosted revision or invoked any production forecast/history API.
- No deployment, workflow dispatch, email, configuration/secret change, historical ledger rewrite or migration. This code changes future behavior only after merge (Python scheduled runs) and separately authorized deployment (Cloudflare).

## Same-day freeze policy

Keep the first ledger observation for each symbol/base date, whether eligible, ineligible or unknown. If it is not eligible, allow **one later eligible publication to append**. All existing rows, snapshots, publication IDs and observed outcomes remain unchanged. Once any eligible row exists for that symbol/date, later same-day candidates are deduplicated. An unqualified/unknown candidate cannot append to an occupied date. Another date remains independent.

For `frozen-close-v1`, all four horizons share the same first target open; 1D eligibility determines daily admission. Each horizon still verifies its own exact target-session prefix during scoring. A malformed longer-horizon snapshot is not repaired or replaced by this change. The close-confirmation buffer, exact target sessions and freeze acknowledgement still apply. A publication generated before the open but acknowledged after the open cannot claim qualification. No record is promoted by changing its old timestamps or by replaying an old serving cache.

The existing immutable UUID archive and cache writes run before admission; archives are retained even when the ledger candidate is deduplicated. A previously blocked publication cannot be retroactively imported as timely. Only a future timely freeze can fill the eligible slot. Storage acknowledgements and failure ordering are unchanged.

The active ledger may now contain the first excluded/unknown observation and the first eligible publication on the same date. Coverage counters count records, so they can exceed the number of dates; scoring, settlement and governance still use qualified outcomes only. The 260-record retention cap is unchanged: this may cover fewer dates. Old rows can still age out under that existing cap; this is not a new indefinite-retention guarantee. UI record keys already tolerate same-date entries.

KV read/modify/write remains nontransactional. This fixes sequential admission, **not globally atomic first-writer selection**. Concurrent writes can still race as documented in Phase 1; no locks, Durable Objects, paid services or recovery job are added. Archive writes per freeze remain unchanged.

## ARIMA evaluation and selection

`Target_Log_Return[t]` is the next bar's return. At origin t's close, labels before t are already observed; label t is not. ARIMA now refits at each scored origin and forecasts exactly one step. This explicitly consumes the now-observed CV gap and earlier validation outcomes; it does not feed the current or future target to the fit. It no longer treats a batch of validation feature rows as one long N-step forecast. `predict` rejects multiple origins; `forecast_steps` remains the explicit live 1D/5D multi-horizon interface.

The pipeline supplies cleaned price history. ARIMA selects returns by date through the current origin, retaining bars dropped by feature filtering; final live refit also reaches the latest observed price. The start remains after the first model feature date, matching the former target series. The internal no-price-history path uses the ordered labeled prefix and assumes consecutive target bars; the production pipeline uses the date-aware path. Missing provider bars cannot be reconstructed, and adjusted historical prices are not a point-in-time vendor archive.

ARIMA CV and outer holdout use `daily-refit-one-step-v2`. The other five candidates retain `fold-fit-features-v1` (fixed fold fit, contemporaneous feature rows); their models/hyperparameters and training gap are unchanged. All candidates score the same validation origins, but their refit policies differ. This bounded repair does **not** establish a common daily-refit tournament for all candidates, nor demonstrate that ARIMA is superior. A future comparison of all daily-refitted candidates should be separately measured before changing their protocol.

Selection uses only training-internal CV direction accuracy, balanced accuracy, majority-class edge, return RMSE and MAPE. The original score weights are retained; CV errors replace outer holdout errors. Exact ties use model name, not holdout errors or input row ordering. Holdout metrics remain reporting-only. Earlier holdout observations may update subsequent ARIMA holdout forecasts, as in daily operation; they cannot change the CV ranking. Tests perturb holdout results and verify invariant CV scores and ranking.

## Failures and outputs

ARIMA forecast states are `ok` and `fallback`. Reasons include `insufficient_history`, `non_convergence`, `invalid_forecast`, and `fit_or_forecast_error:<type>`. The median-return fallback remains numeric; it is not silently labeled a successful ARIMA fit. Current live fallback forces `Low`/`Observe`; ordinary CV quality thresholds and model score weights are unchanged. CV/holdout fallback predictions remain in denominators and error metrics, not removed to improve scores.

- `model_comparison.csv`: `CV_Return_RMSE`, `CV_MAPE`, `CV_Samples`, `CV_Fallback_Count`, `Holdout_Samples`, `Holdout_Fallback_Count`.
- `validation_predictions.csv`: ticker, model, date, fold, origin/last labeled training position, protocol, actual/predicted return, forecast status/reason. For date-aware ARIMA the price history can contain additional bars beyond the labeled training rows; the position field refers to the labeled prefix.
- `prediction_results.csv` / `best_model_predictions.csv`: per-origin holdout status/reason.
- ARIMA `forecast_1d_5d.csv`: status/reason for the actual current multi-horizon fit.
- Daily prediction CSV and new ledger rows: `Model_Forecast_Status`, `Model_Fallback_Reason`. Old records retain missing diagnostics; there is no inference about historic fallback frequency. Existing unknown columns survive ledger loading/writing. CLI summary shows status/reason; CLI, daily action signal and Python API output all become Observe on fallback. The Python API also adds `model_forecast_status` / `model_fallback_reason`; old outputs without these diagnostics remain unknown.

## Validation and limitations

- Python: `OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python -m unittest discover -s tests -q` — 43 tests pass (run in `股票预测`). Covers gap alignment, every-origin visibility, future-label/price perturbations, missing feature bars, live final refit, CV/tie invariance, fallback causes/counts and daily/ledger propagation. Real statsmodels positive/negative synthetic means exercised. An initial low-variance fixture did not converge; its fallback was correctly exposed. The successful-fit smoke fixture uses 1% noise; deterministic tests separately force nonconvergence.
- Diagnostic regression: `python -m unittest discover -s scripts/diagnostics -p 'test_*.py' -q` — 5 pass.
- Frontend: `npm run typecheck` passes. Full `npm test`: 391/392 passed; an unchanged password-storage failure test exceeded its default 5-second timeout. The isolated file retry passed that original test but a different, unchanged 1,000,000-iteration PBKDF2 test exceeded its explicit 15-second limit (30/31 passed). Targeted retry `npm test -- tests/cloudflare-password.test.ts -t 'upgrades pbkdf2-1000000'` passes (12.53-second test). These local timeouts are recorded rather than called a clean full run; authentication code and test limits were not changed. `ORIVANE_SKIP_SEO_REFRESH=1 npm run build:cloudflare` passes (113 pages); generated Worker is refreshed from maintenance source. Build leaves the committed checkout clean. Worker freeze suite: 10/10 pass, including the new append-and-score regressions.
- Backend: `python -m pytest -q` — 8 pass, including current-fallback API signal propagation; existing Starlette/httpx deprecation warning. GitHub CI status is tracked on PR #25 against its latest commit.
- End-to-end local `run_single` smoke on a temporary, fixed-seed synthetic 220-bar CSV passes: six models, 612 exported CV rows, 204 holdout rows, both protocol labels and status fields present, summary generated. Temporary outputs were discarded; no online data or ledger write.
- `git diff --check` passes. The committed prediction ledger, workflows, configuration and dependencies are unchanged. No online market data or hosted mutation is part of validation.

Offline reproducible cost probe: `OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/diagnostics/arima_phase2_check.py`. Fixed synthetic seed 20261020, 200 feature rows, six existing candidates, 120 CV origins and 40 holdout origins each. On Python 3.12.14, numpy 2.5.4, pandas 3.0.6, sklearn 1.9.1, statsmodels 0.15.0: 18.096 seconds; ARIMA 121 successful origins and 39 explicitly reported nonconvergence fallbacks. These are synthetic reliability/cost observations, not market accuracy estimates. Runtime grows with history length and per-origin refits; this is not a hosted job-budget guarantee.

No fresh independent historical OHLC export exists in this checkout, so no new market-performance conclusion or model promotion is made. The old contaminated ledger has not been reused to tune this fix. A never-used future time window is still needed to assess market effectiveness; it must not be presented as independent after being used to redesign selection.

## Review and rollback

Review append-only same-day admission and failure ordering, per-origin time bounds (including feature gaps), holdout-independent score/tie ordering, and fallback propagation. All changes are on the task branch. Cross-review and human merge remain pending; no self-approval or merge. Cloudflare release still needs separate authorization. Revert the implementation commit to roll back code; do not delete appended records or archives or rewrite settled outcomes. The old code's date-only dedupe will not remove already-appended records.
