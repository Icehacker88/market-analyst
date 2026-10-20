# Orivane 项目进度与协作交接

更新：2026-10-16（Asia/Kuala_Lumpur）。本次同步代码分支与进度文档，不合并 main，不部署。

## 当前应使用的版本

2026-10-17 更新：已验收的产品分支合并进 `main`。`main` 现在是唯一的产品主线。

| 用途 | GitHub 分支 / 提交 | 验证与发布状态 |
| --- | --- | --- |
| 产品主线 | `main`（2026-10-17 由 [PR #15](https://github.com/Icehacker88/market-analyst/pull/15) 合并 `codex/ui-preview-ff7fd40d` @ `b41889b`，合并提交 `3e3dd7f`） | 合并后 `main` 的前端应用源码、API 维护源、Worker 生成器、依赖和配置都与 Production 部署 `0b78f7aa` 的来源 `b41889b` 一致，只有 `股票预测/frontend/AGENTS.md` 文档不同。首页、My Research、Research Record、Research Review、Core User Journey Polish 已获用户 Preview 验收；周期涨跌幅、logo 底纹、建议价位三项修复已上线 |
| 原产品分支（已退役） | [`codex/ui-preview-ff7fd40d`](https://github.com/Icehacker88/market-analyst/tree/codex/ui-preview-ff7fd40d) · `b41889b9dd7988bfba421ccc32ca8d9af47dfba1` | 保留作历史，不再在上面开发或提 PR。此前 Preview 验收版本为 `aee719e` |
| Authentication Round 1 | 已于 2026-10-18 由 [PR #17](https://github.com/Icehacker88/market-analyst/pull/17) 合入 `main`（合并提交 `d3dff8a`；原实现 `75289a7`） | 代码在 main 上，但**密码入口默认关闭**：只有设置 `ORIVANE_PASSWORD_AUTH_ENABLED=true` 并配置 Turnstile 两个密钥后才会开启，目前任何环境都没有设置。Claude 审阅 approve；本地 56 个文件 / 361 项测试、typecheck、build 通过。开启前需要 Workers Paid、隔离的 Turnstile 和 Preview 验收，并经用户单独授权。见[验证报告](auth-rebase-main-2026-10-17.md) |

不得从原 main 工作区（有未提交改动）构建产品；不得合并或 cherry-pick `codex/auth-admin-frozen-20260930`。

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
- **Production 当前版本（2026-10-20 发布，用户授权并接受 KV 写入额度与 CPU 两项风险）**：部署 `78128767-0c52-4893-8806-63649639b6ce`，来源 main `6338c10`。这一批上线了认证第一轮（密码入口关闭、Google 登录不变）、#21 时间资格（云端快照与存档、只统计合格样本、合格样本不足 20 个时全站使用保守组合）、#22 原始收盘价结算、#23 战绩页。构建方式同前：干净 worktree、跳过 SEO 刷新、`--branch=main`、未部署 optimizer。**回滚目标**：`0b78f7aa`（来源 `b41889b`）。部署后检查：主要页面和接口均为 200，未出现 1102；`/api/auth/config` 为 `passwordEnabled:false`、`signupEnabled:false`、`googleEnabled:true`；实盘统计 `protocol=frozen-close-v1`、合格 0、已有结果但不计入 152；战绩页横幅为"尚未优于简单基准"，资格表列出原因；新生成的 NVDA 预测带 `evaluation_snapshot`（`price_basis=Close`，base 10-19，生成于美东 10-20 03:52，早于开盘）；治理状态为 `warming_up`，使用 Safe Mode；桌面和 375px 手机都没有溢出，控制台无错误。**发现的问题**：云端账本按"同一资产同一天只保留第一条"去重。今天 NVDA 的 10-19 记录是部署前旧代码在 10-19 收盘前写入的（`base_session_unclosed`），所以新生成的合格预测没能写入。同样的机制以后每天都会出现：美股交易时段内冻结的预测带着未收盘的 K 线，必然不合格，却会先占住当天的位置，收盘后的合格预测就进不了账本。这可能让合格样本积累得很慢，见 TASKS 中的 FREEZE-DEDUPE-INTRADAY。成绩不会因此算错，不需要回滚。
- **下一次从 main 部署时的认证变化（用户 2026-10-18 已接受）**：正式环境目前仍是 `0b78f7aa`（来源 `b41889b`，不含认证第一轮）。下一次从合入 PR #17 之后的 main 部署，会同时带上认证第一轮：密码登录和注册入口关闭，`/api/auth/login|signup` 返回 503；`/auth/logout` 改为要求同源，撤销失败时不再假装退出成功；Google 登录不变。按 Preview 报告推断，旧代码在托管 Workers 上的密码功能本来就返回 500。**部署后的检查清单加一项**：`/api/auth/config` 应返回 `passwordEnabled: false`、`signupEnabled: false`，并确认 Google 登录入口正常。
- **Production 当前版本（2026-10-17 第二次发布，用户授权）**：部署 `0b78f7aa-46c1-4414-a8de-78c77099382d`，来源产品分支 `b41889b`（在 `9340248` 基础上加入 PR #10 建议价位修复，只改前端 4 个文件，配置未变）。**回滚目标**改为 `ee3eefb7-148c-4e86-80e1-49fa3e81bba4`（来源 `9340248`），操作方法同下；更早的 `2bf56aeb` 仍可作为第二回滚点。部署后检查：主要页面和接口均为 200；NVDA 的三块建议统一使用下方 207.95、上方 239.24；涨跌幅正常；logo 无占位图标；控制台无错误。PR #10、#11 按用户指示在 Codex 复核修订之前合并，修订内容尚未经 Codex 确认。
- **Production 已于 2026-10-17 更新**（用户授权）：部署 `ee3eefb7-148c-4e86-80e1-49fa3e81bba4`，来源产品分支 `9340248`（干净工作树，`ORIVANE_SKIP_SEO_REFRESH=1 npm run build:cloudflare`，`wrangler pages deploy out --branch=main`；未部署 optimizer）。生产配置（wrangler.toml 顶层变量和 6 个 KV）与上次部署一致，Secrets 未改动。**回滚目标**：上一版 Production 部署 `2bf56aeb-0e72-4c19-8cb5-f4926cd25725`（来源 `a404860`，dirty 构建），在 Cloudflare Pages → Deployments 中选它，然后点 "Rollback to this deployment"。回滚不会丢用户数据：旧前端用 PATCH 保存，服务端会保留新版本写入的字段。部署后检查：主要页面和接口均为 200；NVDA 1D–1Y 涨跌幅与 `/api/market/returns` 一致；logo 无占位图标；手机首页不溢出；Kronos 端点行为与旧版一致；控制台无错误。已知差异：5Y/10Y/MAX 取自另一份缓存的全历史，与服务端结果可能相差约 1%，旧版同样如此。SEO 预测快照这次未刷新，沿用已提交版本。
- 2026-10-15 上线审计发现 optimizer 35 个资产全部失败（503 与超时），同日 Kronos 上传 67 个结果；二者不同存储/生产路径，不能互相当作完整覆盖证明。这是昨日证据，本次没有触发生产任务或复测性能。
- UI/认证分支含 Preview 隔离配置；文档分支旧源码没有同等配置。任何未来部署均须按所用源码分支重新核对六个 KV、凭据和 `ORIVANE_SKIP_SEO_REFRESH=1`。

## 双 Agent 协作机制现状

更新：2026-10-16，Claude Code 核对。规则见 `AGENTS.md`（共享）和 `CLAUDE.md`（Claude Code 入口，通过 `@AGENTS.md` 导入同一规则）。

| 环节 | 现状 | 触发方式 |
| --- | --- | --- |
| 共享规则、任务看板、交接记录 | `AGENTS.md`、`CLAUDE.md`、`docs/TASKS.md`、本文件；2026-10-16 已合并入 main（PR #1 `6ce85ef`、PR #3 `3582aeb`） | 人工：每个 Agent 开始/结束任务时读写 |
| 需求拆分与分配 | 接收需求的 Agent 写入 `docs/TASKS.md` | 人工：用户向某个 Agent 提出需求 |
| 独立开发 | 每个任务独立分支 + worktree（Codex：`~/.codex/worktrees/`；Claude Code：`~/.claude/worktrees/`） | 人工：用户打开对应 Agent 会话 |
| PR 自动测试 | `.github/workflows/pr-checks.yml` 已合并入 main（PR #2 `0dd1f32`），GitHub 上已运行通过（run 38878824741、38879681705）：前端 Worker 生成 + typecheck + vitest，Python unittest + backend pytest；只读、无 secret、不部署。**不包含 Cloudflare 完整构建**（`build:cloudflare`），通过不等于可部署 | 自动：每个 PR |
| PR 交接模板 | `.github/pull_request_template.md`，已随 PR #2 合并 | 自动：新建 PR 时预填 |
| 交叉 Code Review | 规则已写入 `AGENTS.md`；没有任何集成让一方自动审另一方 PR。两个 Agent 都以用户账号 Icehacker88 发表评论，评论开头须注明是哪个 Agent；GitHub 不允许作者批准自己的 PR，所以规则集不能要求“批准审阅” | 人工：用户让另一 Agent 审阅 PR 编号 |
| 合并 main | 人工决定 | 人工 |
| main 分支保护 | 第 1 步已完成：规则集 `main basic protection`（id 25229676，禁止删除、禁止强制推送，无绕过身份），2026-10-16 经用户授权创建。第 2 步未实施，见下文 | 第 2 步需用户决定 |
| 本机 GitHub CLI | 2026-10-16 已安装 `gh` 并以 Icehacker88 登录；两个 Agent 可创建 PR、发表评论。合并仍须用户决定 | Agent 按需使用 |

本地核验（2026-10-16，Claude Code）：`origin/main` 5534388 前端 27 文件 / 72 测试通过、typecheck 通过；`codex/authentication-round1` 75289a7 前端 54 文件 / 346 测试通过、typecheck 通过；两者 Python unittest 22 项、backend pytest 7 项通过（本机 Python 3.13，CI 使用 3.11）。之后 GitHub PR Checks 在 main 基线上运行通过；认证分支尚未在 GitHub CI 上验证。

### main 分支保护方案（待用户决定，未实施）

约束：`Persist prediction ledger` 步骤以 `GITHUB_TOKEN`（显示为 `github-actions[bot]`）对 `main` 执行普通 `git pull --rebase` + `git push`，workflow 已有 `contents: write`。任何对直接推送生效的“必须走 PR”或“必须通过状态检查”规则都会拦截这次推送。GitHub 规则集的绕过名单只接受角色、团队、GitHub App 和 Dependabot；`GITHUB_TOKEN` 能否作为绕过者没有官方文档说明，须在设置页实际确认，不能假设。

分两步：

1. **已完成（2026-10-16）**：在 Settings → Rules → Rulesets 新建针对 `main` 的规则集，只启用“Restrict deletions”和“Block force pushes”，绕过名单留空。账本步骤是普通推送，不受影响。
2. **要求 PR + PR Checks 时**（`pr-checks.yml` 合并并在 GitHub 跑绿之后）：启用“Require a pull request before merging”和必需状态检查 `frontend`、`python`。账本推送需要一个绕过身份，按以下顺序选一个：
   - a. 若规则集绕过名单里能选到 GitHub Actions：加入该规则集，模式 “Always allow”，只限这一个规则集；workflow 权限不变。合并后观察一次账本运行成功再算完成。
   - b. 否则建一个只装在本仓库的专用 GitHub App，权限仅 Contents: Read and write（不给 Workflows、Administration 等）。把它加入绕过名单；App ID 和私钥存为 Actions secrets；只在 `Persist prediction ledger` 一步用 `actions/create-github-app-token` 换取短时令牌推送，其余步骤仍用只读的默认令牌。这会修改生产 workflow 并新增凭据，必须单独授权。
   - 管理员角色是否也放入绕过名单（模式 “For pull requests only”，便于紧急合并）由用户决定。

在第 2 步完成并验证账本仍能写入之前，不要启用“Require a pull request”。

## 下一步

1. 等待单独授权及用户完成 Paid 环境准备；核验有效 CPU 配额、隔离 Turnstile，再开展 Authentication Round 1 Preview 验收。
2. 后续单独处理公开注册/恢复与 OAuth 安全门槛；不得因本地测试通过就打开公开注册。
3. 明确核心资产持续数据生产，再做 Production 发布与兼容回滚演练。

只同步明确提交的成果。原 main 工作区的未提交内容、冻结旧认证分支、QA 输出、secret、真实账号和私人数据均不纳入本轮同步。合并与部署需另行授权。

## 2026-10-17 Codex 模型后续任务：离线诊断待审阅

[PR #12](https://github.com/Icehacker88/market-analyst/pull/12) 认领并完成 MODEL-SAFE-MODE、LEDGER-ARIMA-BIAS 的第一轮离线诊断，见[报告](diagnostics/model-followup-2026-10-17.md)。固定维护源 9340248 与 Python/账本 38ad853，使用既有历史导出，不调用生产 API。主要发现是预测时间资格待核验、ARIMA 的 CV 目标对齐和验证方式问题、holdout 参与选模；未证明 Safe Mode 组合符号反转或 Router 同期一定更优。任务处于 review，实际模型修复未实施。没有修改生产逻辑、账本、配置或部署；当前发布版本不因此改变。

## 2026-10-19 Codex 时间资格与不可变快照（本地完成，待交叉审阅）

证据已独立提交 [PR #20](https://github.com/Icehacker88/market-analyst/pull/20)，仅文档/精简证据。独立实现分支 `codex/forecast-time-phase1-20261019` 基于 `623a1edd4f5adb770f5b2d09a83716c344166117`，交接见 [Phase 1 契约](forecast-time-phase1-2026-10-19.md)。新结算与治理排除时间不合格或历史证据不足的记录，原实际结果保留；不自动解除 Safe Mode。等待 Claude Code 交叉审阅及战绩页展示衔接。原账本未改，不回填，未触发日报/Kronos，未部署或修改生产配置；线上版本不因本次本地验证改变。


## 2026-10-21 第二阶段：冻结去重与 ARIMA 验证（待交叉审阅）

Codex 从最新 `main` `5f124e8` 建立独立分支 `codex/freeze-arima-phase2-20261020`，交付 [PR #25](https://github.com/Icehacker88/market-analyst/pull/25)。云端同日记录改为保留原始不合格/未知记录，并追加第一条合格发布；不覆盖历史、不回填旧发布。Python ARIMA 改为逐日起点重拟合一步验证，日期截断包含特征筛除的可见价格行，选模只使用 CV 指标和确定性平分规则；当前拟合回退显示原因并保持 Observe。其他候选保留原折内固定拟合协议，不能将本次修复当成所有模型统一每日重拟合的效果比较。

[完整交接、字段兼容性、验证、资源成本与限制](forecast-phase2-2026-10-21.md)。Python 43 项、backend 8 项、诊断回归 5 项、Worker 专项 10 项、typecheck 及 Cloudflare 完整构建通过；本地前端全套曾出现既有密码测试超时，分别复测通过，完整 CI 状态随 PR 记录。尚无新独立市场效果结论。未部署、未手动运行日报/Kronos、未改生产配置/账本；线上状态不因本地验证改变。Claude 交叉审阅及人工合并待完成。
