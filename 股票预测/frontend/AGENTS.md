# Orivane UI workspace boundary

尽可能减少输出内容，专注做事。

UI/product work now happens on `main`: the product branch `codex/ui-preview-ff7fd40d` was merged into `main` on 2026-10-17 at `b41889b` and is retired (do not develop on it). Its history starts at source commit `400a2cdd4d441e2a302d23feb8380c64b69e30b2` (Preview ff7fd40d). Read `docs/version-isolation-2026-09-30.md` before release work.

Authentication/password development is frozen. Preserve existing deployed password, OAuth, session, administrator authorization, account isolation and Production configuration. Do not merge/cherry-pick `codex/auth-admin-frozen-20260930` or copy files/build output from the original dirty checkout. A separate explicit user instruction is required to reopen auth work.

Before a separately authorized Preview deployment, review the complete diff against `codex/preview-ff7fd40d-source`, verify frozen auth/config files and generated Worker, use a clean worktree at the reviewed `main` commit, confirm the Preview branch and all six isolated KV bindings, and skip SEO refresh. Do not use default deployment target inference, Production deployment, or optimizer/all deployment commands. Never deploy simply because code was committed.

Product development cadence: one explicitly bounded round, one reviewed commit, then separately authorized Preview acceptance before the next round. Keep this worktree clean between rounds.
