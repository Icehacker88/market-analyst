# Orivane 项目进度与协作交接

更新：2026-10-16（Asia/Kuala_Lumpur）。本次同步代码分支与进度文档，不合并 main，不部署。

## 当前应使用的版本

| 用途 | GitHub 分支 / 提交 | 验证与发布状态 |
| --- | --- | --- |
| 稳定产品与后续 UI 基线 | [`codex/ui-preview-ff7fd40d`](https://github.com/Icehacker88/market-analyst/tree/codex/ui-preview-ff7fd40d) · `aee719e6aec0ededdd7000d34807c8250708994e` | 首页、My Research、Research Record、Research Review、Core User Journey Polish 已获用户 Preview 验收；这些阶段冻结 |
| Authentication Round 1 | [`codex/authentication-round1`](https://github.com/Icehacker88/market-analyst/tree/codex/authentication-round1) · `75289a744e6533f0c3da3dd007a1656b5fc03dc1` | 基于上述产品提交，仅本地完成；346 项测试、typecheck、Cloudflare build、Pages 打包通过。未部署认证版本 |
| 协作文档 | `codex/agent-collaboration-docs-20261015` · [PR #1](https://github.com/Icehacker88/market-analyst/pull/1) | 文档更新待审阅；此分支本身不包含最新产品源码 |
| main | 本次读取为 `553438897d501a33c7e120009bffd36463c7962e` | 自动任务仍在写入预测账本；不等同于最新 Orivane 产品版本。本轮不覆盖或合并 |

以上 UI 与认证分支于本轮推送至 GitHub，保留原提交 SHA 和隔离边界。同步前两工作树均干净。不得从旧 main 工作区构建最新产品；不得合并或 cherry-pick `codex/auth-admin-frozen-20260930`。

## 已完成产品阶段

- 首页 Round 1 / Round 2 / Round 2.1：搜索、资产发现、移动布局、Service Worker 与 logo 修复；已冻结。
- My Research：完整关注列表恢复、资产级待办、多原因归并、只读 Snapshot、完整性与时效维度；已冻结。已有托管样本中 50 只资产完成只读处理，不等于 50 只都有完整或新鲜研究数据。
- Research Record：保存、编辑个人判断与不可变初始快照，支持无行情/预测。
- Research Review：按稳定记录 ID 到期复核、独立复核历史、继续跟踪和归档。
- Core User Journey Polish：隔离本机草稿、单资产分析页保存入口、复核反馈与历史定位、当前/初始判断区分、同步状态文案。

Preview 验收依据为用户已接受的逐轮交付；不是本次重新执行的浏览器验收。详情及各阶段报告在 UI 分支的 [`股票预测/frontend/docs/`](https://github.com/Icehacker88/market-analyst/tree/codex/ui-preview-ff7fd40d/%E8%82%A1%E7%A5%A8%E9%A2%84%E6%B5%8B/frontend/docs)。

## Authentication Round 1

用户已决定未来采用 Workers Paid，保留现有账号 UUID、KV session 和用户状态。本轮没有升级套餐。

- `@noble/hashes@2.4.0` PBKDF2-SHA256，600000 次，显式 scheme/version/参数。
- 旧 salted SHA-256 和 PBKDF2 按原参数验证；正确验证后才升级，高迭代参数不降低。无批量迁移。
- 默认关闭密码入口与注册开关；加入服务端 Turnstile、尝试次数限制、错误脱敏及退出失败提示。
- 本地 Miniflare/workerd 基准：约 540–615ms/次；V8 CPU 采样约 566ms/次。不是托管 CPU，也不是 Workers Paid 验收。
- 公开注册仍有邮箱归属验证、账号恢复、KV 无法保证全局原子邮箱唯一性等后续门槛；KV 计数不宣称为全局原子限流。

[认证交付、测试、兼容性及回退说明](https://github.com/Icehacker88/market-analyst/blob/codex/authentication-round1/%E8%82%A1%E7%A5%A8%E9%A2%84%E6%B5%8B/frontend/docs/authentication-round1-2026-10-15.md)。上述测试运行于 2026-10-15，本次仅核验提交与同步，没有重跑或重新宣称线上通过。

## 发布和数据生产边界

- 当前主机为 Cloudflare Pages / Workers / KV；`netlify/functions/api.mts` 是维护源，Worker 经生成器更新。不要因此改用 Netlify 发布。
- 本次只读核验 Pages 项目未连接 Git source；分支推送不触发该项目自动部署。现有两个 Actions 仅 schedule / workflow_dispatch，本次未启动任何任务。
- 既有 Preview 地址：<https://codex-auth-phase1-preview.orivane-market-intelligence.pages.dev>。认证新提交未部署。
- Production 的上次核验记录仍是旧版本且包含 dirty 部署标记；本次不重新认定其版本、安全性或用户数据状态，不修改 Production。
- 2026-10-15 上线审计发现 optimizer 35 个资产全部失败（503 与超时），同日 Kronos 上传 67 个结果；二者不同存储/生产路径，不能互相当作完整覆盖证明。这是昨日证据，本次没有触发生产任务或复测性能。
- UI/认证分支含 Preview 隔离配置；文档分支旧源码没有同等配置。任何未来部署均须按所用源码分支重新核对六个 KV、凭据和 `ORIVANE_SKIP_SEO_REFRESH=1`。

## 双 Agent 协作机制现状

更新：2026-10-16，Claude Code 核对。规则见 `AGENTS.md`（共享）和 `CLAUDE.md`（Claude Code 入口，通过 `@AGENTS.md` 导入同一规则）。

| 环节 | 现状 | 触发方式 |
| --- | --- | --- |
| 共享规则、任务看板、交接记录 | `AGENTS.md`、`CLAUDE.md`、`docs/TASKS.md`、本文件（PR #1 及其后续 PR，未合并） | 人工：每个 Agent 开始/结束任务时读写 |
| 需求拆分与分配 | 接收需求的 Agent 写入 `docs/TASKS.md` | 人工：用户向某个 Agent 提出需求 |
| 独立开发 | 每个任务独立分支 + worktree（Codex：`~/.codex/worktrees/`；Claude Code：`~/.claude/worktrees/`） | 人工：用户打开对应 Agent 会话 |
| PR 自动测试 | `.github/workflows/pr-checks.yml` 已提交为 PR，**尚未合并**：前端 typecheck + vitest，Python unittest + backend pytest；只读、无 secret、不部署 | 合并后自动：每个 PR |
| PR 交接模板 | `.github/pull_request_template.md`，与上面同一 PR，尚未合并 | 合并后自动：新建 PR 时预填 |
| 交叉 Code Review | 规则已写入 `AGENTS.md`；没有任何集成让一方自动审另一方 PR | 人工：用户让另一 Agent 审阅 PR 编号 |
| 合并 main | 人工决定 | 人工 |
| main 分支保护 | 未配置（未核验）。注意：Daily Market Report 直接向 main 推送预测账本，配置“必须走 PR”时需让 GitHub Actions 例外，否则会中断账本提交 | 用户在 GitHub 设置 |
| 本机 GitHub CLI | 2026-10-16 本机没有 `gh`，Claude Code 只能 push 分支，PR 需用户点 compare 链接创建；Codex 集成此前创建 PR 返回 403 | 用户安装并登录 `gh` 后可由 Agent 创建 PR 和发表评审 |

本地核验（2026-10-16，Claude Code）：`origin/main` 5534388 前端 27 文件 / 72 测试通过、typecheck 通过；`codex/authentication-round1` 75289a7 前端 54 文件 / 346 测试通过、typecheck 通过；两者 Python unittest 22 项、backend pytest 7 项通过（本机 Python 3.13，CI 使用 3.11）。

## 下一步

1. 等待单独授权及用户完成 Paid 环境准备；核验有效 CPU 配额、隔离 Turnstile，再开展 Authentication Round 1 Preview 验收。
2. 后续单独处理公开注册/恢复与 OAuth 安全门槛；不得因本地测试通过就打开公开注册。
3. 明确核心资产持续数据生产，再做 Production 发布与兼容回滚演练。

只同步明确提交的成果。原 main 工作区的未提交内容、冻结旧认证分支、QA 输出、secret、真实账号和私人数据均不纳入本轮同步。合并与部署需另行授权。
