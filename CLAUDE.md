# Claude Code entry point

Read the repository-root `AGENTS.md` first; it is the shared, authoritative policy for Claude Code and Codex. Then read `docs/ARCHITECTURE.md`, `docs/PROJECT_STATUS.md`, `docs/TASKS.md`, the relevant project README, and any nested instructions for files you will edit.

Work only on the task assigned to you, in the named isolated branch/worktree. Confirm its base SHA and inspect all working-tree changes before editing. Do not assume Codex shares this chat history; use the task board, commits, PR description, and handoff note. Do not edit files owned by another active task. Record changed paths, checks actually run, risks, and the next action before handing work back.

Submit a focused PR to `main` for review. Do not merge your own PR. Production/Preview deployment, production configuration or data changes, scheduled jobs, email delivery, and other live side effects require explicit user authorization for that action. Preserve existing GitHub Actions contracts and the Python/Orivane hosting boundaries described in `AGENTS.md`.
