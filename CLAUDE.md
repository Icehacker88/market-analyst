# Claude Code entry point

Read the repository-root `AGENTS.md` first; it is the shared, authoritative policy for Claude Code and Codex. Then read `docs/ARCHITECTURE.md`, `docs/PROJECT_STATUS.md`, `docs/TASKS.md`, the relevant project README, and any nested instructions for files you will edit.

Work only on the task assigned to you, in the named isolated branch/worktree. Confirm its base SHA and inspect all working-tree changes before editing. Do not assume Codex shares this chat history; use the task board, commits, PR description, and handoff note. Do not edit files owned by another active task. Record changed paths, checks actually run, risks, and the next action before handing work back.

Submit a focused PR to `main` for review. Do not merge your own PR. Production/Preview deployment, production configuration or data changes, scheduled jobs, email delivery, and other live side effects require explicit user authorization for that action. Preserve existing GitHub Actions contracts and the Python/Orivane hosting boundaries described in `AGENTS.md`.

## Cloudflare handoff

The user confirmed on 2026-10-15 that the current host is **Cloudflare Pages**. Read `股票预测/frontend/wrangler.toml`, `package.json`, and `scripts/generate-cloudflare-worker.mjs` for this branch's build/runtime configuration. The API maintenance source is still `netlify/functions/api.mts`; the generator writes `functions/api/[[path]].ts`. Keep this source/generator relationship intact. Netlify configuration files are retained legacy files, not deployment instructions for the current host.

The documentation is currently on `codex/agent-collaboration-docs-20261015`, not merged into `main`. Fetch this branch to read the handoff before starting; create your own task branch/worktree from the explicitly agreed base. Record that base SHA and any prerequisite branch in `docs/TASKS.md`. As of 2026-10-16 the accepted UI branch (`codex/ui-preview-ff7fd40d`, aee719e) and local-only auth branch (`codex/authentication-round1`, 75289a7) are synchronized to GitHub. They are not merged into main. Use `docs/PROJECT_STATUS.md` to choose the exact base; the dirty original checkout and frozen old auth branch remain excluded.

Inspect Preview bindings before using local Wrangler or remote deployment: the inspected remote baseline has no isolated `env.preview` configuration. Do not copy Production KV or credentials into Preview. Review metadata through Cloudflare; a user-confirmed hosting provider is not evidence of a particular live deployment SHA or successful authentication acceptance.
