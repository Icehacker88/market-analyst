# Shared task board

Keep this board concise. Update the owner, status, branch/PR, scope, paths, evidence, and next action whenever work is assigned or handed off. Status values: `queued`, `in_progress`, `blocked`, `review`, `done`.

| ID | Task | Owner | Status | Branch / PR | Scope and changed paths | Checks / evidence | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DOCS-20261015 | Establish shared Codex/Claude collaboration rules and evidence-based project handoff | Codex | review | `codex/agent-collaboration-docs-20261015` | `AGENTS.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATUS.md`, `docs/TASKS.md` | Compared remote `main`, README, both workflows, root Netlify config, local dirty-state summary, and dated local status materials; documentation-only changes | Open/inspect PR, review diff, human merge decision |
| AUDIT-REMOTE-20261015 | Reconcile the 38 local dirty/untracked paths against current remote `main` and determine intended grouping | Unassigned | queued | — | Read-only inventory first; any implementation requires a new scoped task/branch | Not yet inspected against `origin/main` because changes must remain separate from documentation PR | Assign one owner; capture intent, exact diff, tests, and Preview/Production state before proposing integration |
| VERIFY-LIVE-STATUS | Refresh current Actions artifact, Preview/Production deployment, and authentication acceptance evidence | Unassigned | queued | — | Read-only first; do not trigger workflows or deploy | No live workflow artifact or deployment was verified in this update | Inspect latest successful runs/artifacts and deployment metadata without invoking model APIs or writes |
| DOCS-CLOUDFLARE-20261015 | Correct hosting references and Claude Code onboarding | Codex | review | `codex/agent-collaboration-docs-20261015` | Same five documentation files; Cloudflare hosting, maintained API source, branch onboarding and Preview isolation caveat | User confirmation dated 2026-10-15; inspected package scripts, Wrangler config and generator; documentation diff check | Review on the documentation branch; merge through PR when permitted |

## 2026-10-16 状态更新（以下覆盖前文历史状态）

| ID | Task | Owner | Status | Branch / PR | Scope and changed paths | Checks / evidence | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SYNC-20261016 | 将已接受产品和本地认证成果同步 GitHub | Codex | done | `codex/ui-preview-ff7fd40d` / `codex/authentication-round1` | 保留 aee719e / 75289a7 原提交；不修改业务源码或 main | 远端引用核对、干净工作树、待推送文件的常见 secret 模式检查；Pages 无 Git source、Actions 无 push 触发 | 保持产品与认证分支隔离 |
| PRODUCT-PREVIEW | 已完成产品阶段 | Codex | done | `codex/ui-preview-ff7fd40d` · aee719e | 首页、My Research、记录/复核、旅程精修 | 用户已接受 Preview 验收；本次未重跑 | 冻结已验收范围 |
| AUTH-ROUND1 | 密码兼容与安全入口本地实现 | Codex | review | `codex/authentication-round1` · 75289a7 | 密码模块、认证端点/前端、维护生成器及测试；产品功能不变 | 2026-10-15：346 tests、typecheck、Cloudflare build、Pages bundle 通过 | Paid 与隔离 Turnstile 准备完成、另获授权后才做 Preview 验收 |
| DOCS-20261015 | 协作文档与最新进度 | Codex | done | [PR #1](https://github.com/Icehacker88/market-analyst/pull/1) · `6ce85ef` | AGENTS.md、CLAUDE.md、docs/* | PR 上没有正式交叉审阅记录（早于该规则）；用户授权后 2026-10-16 合并 | — |
| AUTH-PUBLIC-LAUNCH | 公开注册、恢复及 OAuth 剩余安全门槛 | Unassigned | queued | — | 邮箱归属、恢复、全局唯一性、最终发布保护 | 尚未实施/验收，不因 Round 1 自动开放 | 单独确定下一轮范围 |
| DATA-PRODUCTION | 核心资产持续生产 | Unassigned | queued | — | 复用已有生产能力，区分 Kronos/冻结预测/行情 | 2026-10-15 审计证据，非本次性能复测 | 单独授权诊断与实施，不触发 optimizer |
| COLLAB-CLAUDE-20261016 | Claude Code 协作规范、对等分工、交叉审阅与请求流程 | Claude Code | done | [PR #3](https://github.com/Icehacker88/market-analyst/pull/3) · `3582aeb` | `AGENTS.md`、`CLAUDE.md`、`docs/PROJECT_STATUS.md`、`docs/TASKS.md` | Codex 审阅 approve；改为指向 main 后差异仅 4 个文档文件；PR Checks 通过（run 38879681705）；用户授权后合并 | — |
| CI-PR-CHECKS-20261016 | PR 自动测试与 PR 交接模板 | Claude Code | done | [PR #2](https://github.com/Icehacker88/market-analyst/pull/2) · `0dd1f32` | `.github/workflows/pr-checks.yml`、`.github/pull_request_template.md` | Codex 审阅 approve；GitHub CI frontend/python 通过（run 38878824741）；不含 Cloudflare 完整构建 | — |
| GITHUB-SETUP | main 分支保护第 2 步（要求 PR + `frontend`/`python` 检查），须先为账本推送确定绕过身份；可选：Agent 自动审阅集成 | 用户 | queued | — | GitHub 设置；方案见 PROJECT_STATUS | `gh` 已登录；第 1 步规则集已启用（2026-10-16） | 用户决定第 2 步；集成可能产生费用，需先确认 |
