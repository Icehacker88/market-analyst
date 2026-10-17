# Orivane Authentication Round 1 workspace

尽可能减少输出内容，专注做事。

Product work uses isolated feature branches based on `origin/main`, which is the integration line. This isolated worktree uses `codex/authentication-round1`; AUTH-REBASE-MAIN updates the original local authentication implementation (`75289a7`, based on `aee719e`) by merging main `b71c3b13ae438e5c969832ec4d10712e300da53b`. The user authorizes branch integration, local verification and a PR only, not new authentication behavior or configuration changes. Do not merge or cherry-pick `codex/auth-admin-frozen-20260930`, or copy files/build output from the original dirty or UI checkouts. The retired product branch is historical only.

Preserve existing account UUIDs, KV sessions, user-state paths, Research Record/Review, homepage, read-only Snapshot and prediction algorithms. New credential writes require explicit enablement; registration remains disabled by default. Never log credentials, credential records or session tokens. Only synthetic accounts may be used in tests.

No plan/billing changes, deployment, remote account mutation or Production configuration changes are authorized. Keep one bounded integration commit, a clean worktree, and stop for separate Preview authorization after local verification.

Before a separately authorized Preview deployment, read `docs/version-isolation-2026-09-30.md` and the authentication delivery report, review the full authentication diff against main and the deployed baseline, verify maintenance source and generated Worker, use a clean worktree at the reviewed commit, confirm the Preview branch and all six isolated KV bindings, and skip SEO refresh. Do not use default deployment target inference, Production deployment, or optimizer/all deployment commands. Never deploy simply because code was committed.
