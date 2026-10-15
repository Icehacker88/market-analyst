# Repository collaboration rules

These rules apply to GPT-6 Astra/Codex, Claude Opus 5.5/Claude Code, and human contributors. The human user owns scope, priorities, and release decisions. Model names describe intended roles, not guarantees of capability.

## Source of truth and task handoff

- Before work, read `README`/`股票预测/README.md` as relevant, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATUS.md`, `docs/TASKS.md`, and any applicable nested `AGENTS.md` or `CLAUDE.md`.
- Confirm the current remote `main` SHA, branch, worktree, clean/dirty state, open PRs, and relevant Actions/Preview deployment status. Never infer current state from an old local checkout or report.
- Keep task state in `docs/TASKS.md`: one owner (Codex, Claude Code, or human), status (`queued`, `in_progress`, `blocked`, `review`, `done`), scope, branch/PR, changed paths, checks, and next action. Update it in the same change when handoff state changes.
- Handoff notes must record base SHA, branch/worktree, completed work, exact changed paths, checks and results, known risks, and the next concrete action. Treat another model's output as a proposal until reviewed.

## Branches and worktrees

- Keep `main` as the protected integration line. Do not work directly on it, force-push it, reset it, or rewrite shared history.
- Give each bounded task a unique branch and isolated worktree, based on a freshly fetched `origin/main` (or explicitly documented prerequisite branch). Suggested names: `codex/<scope>-YYYYMMDD` and `claude/<scope>-YYYYMMDD`.
- Never let both agents edit the same worktree. Assign file/path ownership in the task record; split tasks where ownership overlaps. Share progress through Git commits/PRs and these docs, not assumed chat-memory sharing.
- Before starting, inspect uncommitted changes. Preserve user changes exactly; do not stash, reset, clean, checkout over, or include unrelated files. If isolation cannot be established, stop and report.
- Keep commits focused and attributable. Do not push secrets, local datasets, generated reports, credentials, `.env`, or ignored state.

## Division of work

- **Codex / GPT-6 Astra:** default integrator and repo-wide coordinator; inspect task state, define bounded work and file ownership, implement cross-cutting/backend/Python/Actions changes when assigned, run scoped checks, review Claude's PRs, reconcile conflicts, and update status/handoff docs.
- **Claude Code / Claude Opus 5.5:** default independent implementation partner for assigned frontend/UI or other explicitly scoped tasks; inspect current code and rules first, work only in its assigned branch/worktree, document decisions and test evidence, and open a PR for review.
- Either model may implement another area when the task board explicitly assigns it. Neither model may self-approve its own changes or treat a second model's review as human authorization for a protected action.
- Parallelize only disjoint paths or clearly separable interfaces. For shared files, agree on one owner and interface first; integrate sequentially.

## Review, checks, and merge

- Open a PR targeting `main` for every change intended for the shared repository. Include purpose, scope, evidence, tests/checks, data/deployment impact, and rollback notes when applicable. Keep PRs small enough to review.
- The author runs checks appropriate to changed paths and records exact commands and outcomes. Do not claim a test passed if it was not run. Review current Actions and required checks before merge; fix failures and inspect the final diff.
- A model may review but may not merge its own PR. Require a human review/merge decision unless the user has explicitly established a different repository policy. Never bypass branch protections or required checks.
- Resolve conflicts by fetching current `main`, rebasing or merging only the task branch as repository policy allows, then re-running affected checks. Never resolve by discarding another contributor's changes without authorization. Record resolutions in the PR.
- After merge, verify the merge commit and Actions result, update `docs/PROJECT_STATUS.md` and `docs/TASKS.md`, and identify whether deployment occurred. A successful merge is not proof of deployment.

## Safety and permissions

- Read-only inspection, local edits, local builds/tests, branch pushes, and draft PRs are in scope when needed for the assigned task. External writes must be specifically required by the task.
- Never deploy to Production, alter production environment variables/secrets/KV, run optimizer or scheduled jobs manually, send report emails, trigger live forecast/settlement tasks, migrate/delete user data, change billing/plans, or rotate credentials without explicit user authorization for that specific action.
- Never expose, copy, print, commit, or place secrets in reports. Use names/status only when documenting configuration. Keep production and Preview credentials, KV namespaces, generated data, and identities isolated.
- Preview is also an external write. Deploy only after explicit user authorization naming the target and intended scope. Verify Preview bindings are isolated from Production, skip SEO refresh where required, and do not run all/optimizer deployment commands by default.
- Do not weaken authentication, authorization, privacy, forecast validation, or investment-risk disclosures to make a build/test pass. Escalate ambiguous security or data-integrity changes for human review.
- Preserve the distinction between source implementation, local validation, Preview acceptance, and Production release. Do not claim the latter from the former.

## Project-specific constraints

- This repository contains Python market analysis/report automation and the Orivane web application. Keep their data and deployment pipelines distinct.
- `.github/workflows/daily-market-report.yml` writes the prediction ledger to `main`, emails a report, and uploads an artifact. Preserve its schedule, deduplication, market-session gate, permissions, and artifact contract unless a task explicitly changes them.
- `.github/workflows/kronos-daily.yml` uses GitHub OIDC to request forecasts from the deployed site. Preserve its identity and artifact contract; do not trigger it casually.
- The user confirmed on 2026-10-15 that Orivane is hosted on **Cloudflare Pages**, with Pages Functions/Workers and KV. Use the Cloudflare configuration and deployment metadata when investigating hosting. Netlify configuration files are legacy configuration, not a separate active Python hosting path. Do not configure or deploy Netlify for this project unless the user explicitly requests a hosting change.
- `股票预测/frontend/netlify/functions/api.mts` remains the maintained API source consumed by `scripts/generate-cloudflare-worker.mjs`, which generates `functions/api/[[path]].ts`. Do not delete or rename this source or its dependencies merely because their names contain Netlify.
- Before any authorized Cloudflare Preview work, inspect the exact branch configuration. The inspected remote baseline has no `env.preview` section and its `preview:cloudflare` script does not select an isolated Preview environment; local historical isolation reports do not establish isolation for a fresh checkout.
- Keep Cloudflare Worker maintenance source and its generated output in sync using the repository scripts. Do not hand-edit generated worker files as the sole source of a change.
- Investment forecasts are research outputs, not trading advice. Do not introduce brokerage orders or represent backtests/estimates as realized returns.
