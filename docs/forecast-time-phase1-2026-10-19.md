# Forecast Time Phase 1 — implementation handoff

- Task: `FORECAST-TIME-PHASE1`; Owner: Codex; reviewer: Claude Code; status: review.
- Base: `origin/main` `623a1edd4f5adb770f5b2d09a83716c344166117`.
- Independent branch: `codex/forecast-time-phase1-20261019`; worktree: `~/.codex/worktrees/orivane-time-phase1/Market Analysis`.
- Evidence-only [PR #20](https://github.com/Icehacker88/market-analyst/pull/20) is separate. This branch does not copy its report bundle or require its merge to build.
- Local implementation only. No production API, ledger migration, workflow dispatch, Preview/Production deployment or configuration change.

## Implemented protocol

`frozen-close-v1` is a full-window close-to-close forecast: base is a completed regular session; generation and durable freeze acknowledgement must precede the **first** target session's regular open. Each horizon has its own exact target (`1D=1`, `5D=5`, `10D=10`, `1M=22` sessions); publication after the first open cannot qualify as a complete 5D/1M forecast just because its end is still in the future.

Calendar is versioned `us-equity-2026-2027-v1`, based on [NYSE hours/calendars](https://www.nyse.com/trade/hours-calendars), with holidays, early closes and America/New_York DST. Python's reviewed symbols are SPY/QQQ/NVDA; Cloud additionally accepts stock/ETF metadata with USD and a recognized US equity exchange. Other markets, indices (including NDX/VIX), FX, uncertain identities and dates outside calendar coverage remain unknown. Emergency exchange closures are not dynamically covered; calendar maintenance is required, not inferred from weekends alone.

The source retrieval timestamp must be at least 15 minutes after the base close (and after the target close to settle). This is a conservative eligibility policy for potentially delayed daily bars, **not proof that Yahoo has finalized or will never revise its data**. Data date and retrieval time remain distinct. Cached history retains the original retrieval time; old caches lacking it cannot qualify. Provider native publication time is unavailable and is not invented.

Snapshots fix symbol, base date/price, price basis, source, source retrieval time, actual generation completion, freeze time, protocol/calendar version and target sessions. Price revisions, mixed source/basis, missing exact targets or unfinished sessions block settlement. Settled outcomes/evidence are never recomputed. Python retains its existing log-return / 5D volatility definition; Cloud retains arithmetic horizon returns. They must not be pooled as identical return measures.

## Public API contract (for Claude Code's track-record UI)

Existing routes and response envelopes stay intact; fields are additive except tightened meanings of `Verified`, completed counts, accuracy and governance. Paths below have the normal `/api` prefix when served on Pages.

| Surface | Fields / changed meaning |
|---|---|
| `/predictions/history/:symbol` | Top-level `evaluation_protocol="frozen-close-v1"`, `horizon_statistics`; `live` and rebuilt `legacy` sections have the same qualification annotations. `backtest` remains explicitly simulated (`walk-forward`). |
| History and scoreboard live records | `Time_Eligibility[1D/5D/10D/1M]={status,reason,protocol}`; `Outcome_Observed[horizon]` says only whether the raw outcome exists. `Verified`, `Verified_5D`, `Verified_10D`, `Verified_1M` require qualifying timing, settlement evidence and an actual outcome. Old actual-return / correctness fields remain available unchanged even when `Verified=false`. |
| Newly written live records | `Publication_ID`; `Evaluation_Snapshot={schema_version,calendar,symbol,base_session,base_price,price_basis,source,source_observed_at,generated_at,frozen_at,target_sessions}`; `Outcome_Evidence[horizon]={source,price_basis,base_price,actual_price,target_session,source_observed_at,settled_at}`; `Settlement_Status[horizon]`. Missing historical fields are not synthesized. |
| Live `statistics` and `horizon_statistics` | Add `protocol`, `observed`, `eligible`, `ineligible`, `unknown`, `excluded`. Existing `completed` and accuracy/edge/errors use only qualified settled samples. No qualified sample => accuracy/edge/errors `null`, not 0% and not inferred improvement. |
| `/forecast/scoreboard` | Above contract in `live`, `per_asset[].live`, `recent_live_records`. `per_asset[].governance` uses qualified input; insufficient samples stay `warming_up` with conservative ensemble, not evidence to unlock Router. Backtest remains separate. |
| `/performance/:symbol` | `live_predictions.statistics` uses the qualified statistics above. Legacy static fallback replaces unsupported live statistics with an empty, explicitly unqualified result. Backtest/model math is unchanged. |
| Forecast payloads | New `evaluation_snapshot` captures generation inputs. Its `frozen_at` is **null** before acknowledgement, including the serving forecast cache; confirmed `frozen_at` is in the ledger's `Evaluation_Snapshot`. A forecast payload alone is not proof of qualified publication. |

Statistics semantics:

- `eligible + ineligible + unknown = input record count` (per horizon). Eligible is timing/input eligibility, not settled count.
- `observed` = raw actual-return field exists. `excluded` = observed but outcome evidence/timing does not qualify.
- Cloud coverage counters above span the input history; its `window` selects the last N **qualified completed** samples for scoring. `pending` remains the old raw-missing-outcome count, so it is not “eligible and awaiting result”; do not label it as such.
- Python CSV metrics keep their existing last N **record** window (filter within that window). Add `Evaluation_Protocol`, `Observed_1D`, `Eligible_1D`, `Ineligible_1D`, `Unknown_1D`, `Excluded_1D`. Do not equate the two window definitions in the UI.
- Backtest is selected only by an explicit internal call context. A row carrying `Backtest=true` cannot bypass live qualification. Simulated statistics must not be labeled live results.

Qualification reasons (stable strings in this version):

| Status | Reason | Suggested user meaning |
|---|---|---|
| eligible | `qualified` | 时间与快照条件满足；是否已有结果另看 Verified |
| ineligible | `published_after_target_open` | 冻结/生成晚于完整预测窗口起点 |
| ineligible | `base_session_unclosed` | 日收盘基准尚未完成；不适用于该协议（不等于模型预测错误） |
| ineligible | `source_close_unconfirmed` | 源数据取数未满足收盘后的确认缓冲 |
| unknown | `unsupported_market_calendar`, `calendar_unavailable` | 交易时段资格未确认 |
| unknown | `generation_time_missing`, `legacy_snapshot_missing`, `snapshot_time_missing` | 历史时间/冻结证据不足 |
| unknown | `snapshot_identity_mismatch`, `target_sessions_mismatch`, `price_provenance_missing`, `snapshot_time_order_invalid` | 数据证据无法一致核验 |

Settlement statuses: `settled`, `awaiting_target_close`, `timing_not_qualified`, `target_data_missing`, `target_data_unconfirmed`, `price_provenance_mismatch`, `base_price_revised`, `target_price_invalid`. They are result availability reasons, not investment decisions or model misses. Historical excluded samples remain visible and exclusions must be displayed, not hidden to make accuracy appear better.

## Write paths, compatibility and cost

Python: provider timestamp -> per-asset readiness gate -> actual model completion timestamp -> append new snapshot -> atomic CSV replace -> acknowledgement -> persist acknowledgement. New text columns are `Evaluation_Snapshot_JSON` / `Outcome_Evidence_JSON`; summary gains `Forecast_Generated_At`. Existing unknown extra columns survive. No historical snapshot is reconstructed, and legacy outcomes are not settled/backfilled. The committed original ledger is unchanged. Future authorized scheduled runs will write new columns/rows; this PR does not run that schedule. A local file acknowledgement is not a claim that GitHub push/email delivery already succeeded.

Cloud: history provenance -> generated forecast snapshot -> unique append-only `publications/time-v1/<UUID>.json` -> existing serving cache -> acknowledgement -> existing per-symbol ledger with Publication_ID -> existing governance. The immutable publication copy survives serving-cache replacement and ledger retention. A cached forecast read no longer inserts a retroactive ledger entry. Failed writes do not claim successful ledger publication.

New forecasts normally add **one KV write** (archive + cache + ledger = 3 writes versus 2 previously), plus storage equal to each archived forecast payload. No expiry/deletion is introduced. Existing per-day ledger deduplication and 260-record index retention remain. KV is not transactional, WORM or a global first-writer lock: concurrent generators can leave multiple immutable publication objects while the mutable index races. The unique archive preserves source evidence; this stage does not claim global exactly-once settlement or build an archive-recovery service. A partial write can leave an orphan archive/cache; no forged freeze time is used to repair it on reads.

Statistics KV keys and the scoreboard edge-cache key are versioned so pre-fix scores cannot pass as new protocol scores. No existing KV keys are cleared. Snapshot APIs (including My Research read-only), auth, user state, frontend, workflows and model algorithms are unchanged. Governance's insufficient-sample guard changes selection eligibility only; no weights are fitted or winners selected from contaminated history.

## Verification and limits

- Python unittest: 29 tests; backend pytest: 7 tests (existing Starlette/httpx deprecation warning).
- Frontend: 57 files / 368 tests, including generated Worker exercised with Miniflare/workerd; typecheck; Cloudflare build with `ORIVANE_SKIP_SEO_REFRESH=1`.
- Shared fixtures: all 46 confirmed late records rejected; 22 other audit flags receive conservative unclosed-base or unsupported-calendar reasons, without upgrading them into confirmed late-after-outcome cases.
- Covers DST, holidays, early close, unknown calendar, corrupt/missing snapshot, exact target, source timing, price revision, immutable settlement, no legacy backfill, observed-vs-qualified counts, conservative governance and archive/cache/ledger write failure.
- No live market/network calls in the new Worker tests. Tests prove the generated execution path under local workerd, not hosted CPU limits, cross-location KV consistency or deployed results.
- CI is independently reported on the PR; local results do not imply deployment. No manual Daily/Kronos run.

## Review / release order

Claude Code reviews timing boundaries, snapshot immutability, arithmetic-vs-log distinction, partial storage failure, API compatibility and conservative governance. The evidence PR can merge independently; implementation does not change old evidence. Resolve the TASKS entry to one task after both PRs merge (evidence says in progress; this handoff says review).

Before any deployment: adapt track-record UI to the field meanings above; show unknown/excluded and null scores; verify isolated Preview with separately authorized synthetic data and hosted resource measurements. Expect qualified live sample counts to drop, potentially to zero. This is an integrity correction, not a measured model performance gain.

Rollback is a code revert plus separately authorized deployment; do not delete archives or rewrite old rows. Reverting qualification would restore contaminated scoring, so keep public score display gated if rollback is needed. No automatic rollback, migration or release is performed here. ARIMA validation/selection remains the separately scoped next phase.
