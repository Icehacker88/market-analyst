# Claude Code entry point

The repository-root `AGENTS.md` is the shared, authoritative policy for Claude Code and Codex. It is imported below so Claude Code loads it automatically. This file only adds Claude Code mechanics; if anything here seems to conflict with `AGENTS.md`, `AGENTS.md` wins and the conflict should be fixed in a PR.

@AGENTS.md

## Start of every session

1. Read `docs/PROJECT_STATUS.md` and `docs/TASKS.md` from the freshly fetched branch you will work from (until the docs PR is merged, that may be a docs branch; `PROJECT_STATUS.md` names the current bases).
2. `git fetch origin`, then confirm the `origin/main` SHA, open PRs, the existing worktrees (`git worktree list`), and which tasks Codex currently owns. Do not edit paths owned by an `in_progress` Codex task.
3. Claude Code loads `CLAUDE.md` files but not `AGENTS.md` files on its own. Before editing under a directory, read any nested `AGENTS.md` there (for example `股票预测/frontend/AGENTS.md` on the product branches); its freeze and deployment rules apply to you.
4. Do not assume Codex shares this chat history. Everything Codex needs must be in a commit, PR, or the docs.

## Worktrees on this machine

- The original checkout at `~/Documents/Market Analysis` holds uncommitted changes that are not yours. Never edit, stash, reset, clean, build, or commit there. Use it only for read-only `git` commands.
- Create each task worktree from a fresh remote base: `git worktree add -b claude/<scope>-YYYYMMDD ~/.claude/worktrees/market-analyst-<scope> <base>`. Codex's worktrees live under `~/.codex/worktrees/`; do not touch them.
- For reviewing or verifying another branch, use a detached worktree (`git worktree add --detach ...`) and remove it when done.

## GitHub access

- Check `gh auth status` at the start of a session. If the GitHub CLI is unavailable, push the branch with `git` and give the user the compare link (`https://github.com/Icehacker88/market-analyst/compare/<base>...<branch>`) to open the PR. Record the PR number in `docs/TASKS.md` once it exists.
- Post reviews as PR comments when you can write to GitHub; otherwise hand the review text to the user, as `AGENTS.md` describes.

## Reviewing a Codex PR

1. Check out the PR head in a detached worktree; diff it against the PR base, not against your local `main`.
2. Read every changed file in full context. Check callers before accepting a changed public interface. API changes belong in `netlify/functions/api.mts`; the generated `functions/api/[[path]].ts` is gitignored and rebuilt by the generator.
3. Run the checks for the changed paths (frontend: `npm ci`, `node scripts/generate-cloudflare-worker.mjs`, `npm run typecheck`, `npm test`; Python: `python -m unittest discover -s tests -q` in `股票预测`). Report only commands you actually ran.
4. Give a verdict with findings ordered by severity, each with file, line, and a concrete failure scenario. Propose fixes; do not push to Codex's branch unless the task board assigns it to you.

## Cloudflare handoff

The user confirmed on 2026-10-15 that the current host is **Cloudflare Pages**. Read `股票预测/frontend/wrangler.toml`, `package.json`, and `scripts/generate-cloudflare-worker.mjs` for the branch's build/runtime configuration. The API maintenance source is still `netlify/functions/api.mts`; the generator writes `functions/api/[[path]].ts`. Keep this source/generator relationship intact. Netlify configuration files are retained legacy files, not deployment instructions for the current host.

Inspect Preview bindings of the commit being deployed before using local Wrangler or remote deployment. Do not copy Production KV or credentials into Preview. A user-confirmed hosting provider is not evidence of a particular live deployment SHA or successful authentication acceptance.

Base product work on a fresh `origin/main`; the accepted UI branch was merged into it on 2026-10-17 and is retired. `docs/PROJECT_STATUS.md` records any other active base (such as the local-only auth branch). Record your chosen base SHA and any prerequisite branch in `docs/TASKS.md`. Never base work on the dirty original checkout or the frozen `codex/auth-admin-frozen-20260930` branch.
