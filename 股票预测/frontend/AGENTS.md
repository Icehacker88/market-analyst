# Orivane Authentication Round 1 workspace

尽可能减少输出内容，专注做事。

This isolated worktree uses `codex/authentication-round1`, based on stable product commit `aee719e6aec0ededdd7000d34807c8250708994e`. The user explicitly reopened password/signup/login work for local implementation and verification only. Do not merge or cherry-pick the old frozen authentication branch, or build from the original main/UI checkouts.

Preserve existing account UUIDs, KV sessions, user-state paths, Research Record/Review, homepage, read-only Snapshot and prediction algorithms. New credential writes require explicit enablement; registration remains disabled by default. Never log credentials, credential records or session tokens. Only synthetic accounts may be used in tests.

No plan/billing changes, deployment, remote account mutation or Production configuration changes are authorized. Keep one bounded commit, a clean worktree, and stop for separate Preview authorization after local verification.
