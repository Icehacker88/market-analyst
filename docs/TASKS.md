# Shared task board

Keep this board concise. Update the owner, status, branch/PR, scope, paths, evidence, and next action whenever work is assigned or handed off. Status values: `queued`, `in_progress`, `blocked`, `review`, `done`.

| ID | Task | Owner | Status | Branch / PR | Scope and changed paths | Checks / evidence | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DOCS-20261015 | Establish shared Codex/Claude collaboration rules and evidence-based project handoff | Codex | review | `codex/agent-collaboration-docs-20261015` | `AGENTS.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATUS.md`, `docs/TASKS.md` | Compared remote `main`, README, both workflows, root Netlify config, local dirty-state summary, and dated local status materials; documentation-only changes | Open/inspect PR, review diff, human merge decision |
| AUDIT-REMOTE-20261015 | Reconcile the 38 local dirty/untracked paths against current remote `main` and determine intended grouping | Unassigned | queued | — | Read-only inventory first; any implementation requires a new scoped task/branch | Not yet inspected against `origin/main` because changes must remain separate from documentation PR | Assign one owner; capture intent, exact diff, tests, and Preview/Production state before proposing integration |
| VERIFY-LIVE-STATUS | Refresh current Actions artifact, Preview/Production deployment, and authentication acceptance evidence | Unassigned | queued | — | Read-only first; do not trigger workflows or deploy | No live workflow artifact or deployment was verified in this update | Inspect latest successful runs/artifacts and deployment metadata without invoking model APIs or writes |
