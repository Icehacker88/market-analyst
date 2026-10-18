# AUTH-REBASE-MAIN：认证分支同步与本地验证

日期：2026-10-17。负责人：Codex。状态：本地完成，待交叉审阅；没有部署或启用认证入口。

## 版本与合并

- 工作区：`/Users/icehacker/.codex/worktrees/orivane-auth-round1/Market Analysis`，分支 `codex/authentication-round1`。开始时工作树干净。
- 原认证提交：`75289a744e6533f0c3da3dd007a1656b5fc03dc1`，原产品基线 `aee719e6aec0ededdd7000d34807c8250708994e`。
- 本次合入最新 `origin/main`：`b71c3b13ae438e5c969832ec4d10712e300da53b`（含 PR #15 产品整合、PR #16 协作说明修订）。采用 merge，不改写既有认证历史。
- 唯一冲突是 `股票预测/frontend/AGENTS.md`：保留认证分支的本地验证边界，同时采用 main 的独立 feature branch 协作方式和 Preview 隔离检查。未出现业务代码冲突。
- 另更新 `docs/TASKS.md`、`docs/PROJECT_STATUS.md` 与本报告。没有手动修改任何认证、产品或模型实现。

## 完整性核验

- 原认证提交相对原基线的 16 个非 AGENTS 文件，在合并工作树中逐字节不变，包含密码实现、维护 API、生成器、UI、测试、依赖和原交付报告。
- main 自原基线更新的 11 个其他前端文件逐字节保留，包含周期收益、logo、建议价位和回归测试。
- `wrangler.toml`、optimizer 配置与原认证提交和 main 都无差异；没有新增环境变量、修改凭据或启用密码/注册开关。
- SEO 快照保持 main 的版本；构建明确设置 `ORIVANE_SKIP_SEO_REFRESH=1`，不刷新远端预测。
- main 的工作流、Python、账本和诊断文件由 merge 原样带入；相对 main 没有这些目录的新增改动。未使用旧冻结认证分支或原 dirty 工作区成果。

## 本次实际验证

在上述认证工作区的 `股票预测/frontend`，Node v26.0.0、npm 11.12.1：

| 命令 | 本次结果 |
| --- | --- |
| `npm ci --no-audit --no-fund` | 成功；有既有依赖 whatwg-encoding / glob 的弃用提示，未升级依赖 |
| `npm test` | 56 文件 / 361 项通过；pretest 从维护源生成 Cloudflare Worker，包含本地 workerd 密码与会话测试 |
| `npm run typecheck` | 通过 |
| `ORIVANE_SKIP_SEO_REFRESH=1 npm run build:cloudflare` | 通过；113 个静态页面生成完成，无构建警告 |
| `git diff --check` | 通过 |

没有重新执行密码性能 benchmark。2026-10-15 报告中的耗时仍是历史本地测量，不是本次托管 CPU、Paid 配额或真实登录验收。没有运行生产接口、邮件、日报、optimizer、Kronos 或部署命令。

## PR 和后续边界

PR 到 main 包含原有 Authentication Round 1 实现和本次同步文档，不应描述为仅有文档的 PR。密码及注册仍要求既有显式配置；缺少配置时默认关闭。若将来发布，必须单独评估这种入口行为与生产现状的兼容性，不能直接把“可合并”视为“可公开上线”。

下一步由 Claude 交叉审阅；用户决定合并。真实 Preview 验收仍需要单独授权、有效 Workers Paid CPU 条件和隔离 Turnstile，详见 `股票预测/frontend/docs/authentication-round1-2026-10-15.md`。公开注册、邮箱归属和恢复的原有门槛不变。

本次没有新凭据写入或用户数据迁移。源码合并可按普通 PR 回退；将来一旦产生新格式密码，不能直接部署不认识新格式的旧 verifier。保留原交付报告的兼容回退限制。
