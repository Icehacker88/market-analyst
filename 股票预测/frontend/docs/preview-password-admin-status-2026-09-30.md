# Preview 密码与管理员复核状态

核验日期：2026-09-30，Asia/Shanghai。**用户本次截图已确认 Workers Free，适用官方 10 ms CPU/request 限额；现有证据不足以支持安全参数稳定运行，密码接入、托管 benchmark 和部署均停止。本轮没有修改应用源码、生产配置或密码记录，没有部署 Preview 或 Production。**

> 版本隔离复核补充：不能将“本轮未部署”理解为“管理员代码未在 Preview”。当前 `ff7fd40d` 的线上 JS 已含严格 `is_admin` 判定及管理员拒绝清理事件，且与 9 月 10 日部署留档逐字节一致；源码及部署构建记录也表明当时使用了已有认证修改。密码新方案未接入，真实密码/管理员流程未验收。详见 [版本隔离记录](version-isolation-2026-09-30.md)。

## 1. 当前阻塞与可选路径

9 月 30 日用户明确确认“目前是 free”，并提供本账户 Workers plans 截图，其中 Free 卡片标记 **Current plan**。这是本次套餐证据，不再依赖 9 月 8 日历史判断。截图未展示 CPU 数值；本次重新读取 Cloudflare [Workers 限制文档](https://developers.cloudflare.com/workers/platform/limits/)，Free 的 HTTP CPU 限额为 **10 ms/request**。[Pages Functions 说明](https://developers.cloudflare.com/pages/functions/pricing/)说明其使用 Workers 配额。没有实测托管 CPU，也未宣称本地耗时等同于托管耗时。

此前只读账号 API 的 `default_usage_model=standard`、空 entitlements 及无显式限额不能判定套餐；浏览器自动读取曾因网络错误/超时失败。这些先前障碍已由用户提供的当前套餐截图补足，不再要求重复登录。

历史本地 Miniflare/workerd 的 Argon2id 约 22 ms CPU/次、PBKDF2-600000 约 533 ms CPU/次均高于 Free 名义限额，尚无满足该配额的稳定运行证据。依据用户明确的停止条件，维持密码接入和部署停止，不以偶发超额宽限作为上线依据。未读取账单、secret 值或真实用户密码记录，未执行套餐升级。

后续路径：

1. 保持 Free：保留已有本地管理员成果，密码接入及部署暂停，完整真实登录验收继续标记未完成。
2. 用户日后自行决定升级套餐后，再核验有效 CPU 限额，并完成本地及隔离托管 benchmark；升级不等于算法已经验收，本轮不执行升级。
3. 另一选项是单独评估适合安全密码派生的认证运行环境；这需要新的架构范围，不在本轮迁移。

不以降低参数、把 210000 作为新格式、公开高成本测试接口或直接写入 session 夹具绕过阻塞。

## 2. 实际 Preview 环境

- Alias：[Preview](https://codex-auth-phase1-preview.orivane-market-intelligence.pages.dev)
- 固定版本：[ff7fd40d](https://ff7fd40d.orivane-market-intelligence.pages.dev)
- 当前成功部署 ID：`ff7fd40d-0258-4689-950f-0509aaff1937`，environment=`preview`，branch=`codex/auth-phase1-preview`。这是既有部署，本次没有上传。
- Production 当前部署 ID：`2bf56aeb-0e72-4c19-8cb5-f4926cd25725`；本轮没有 Production 发布或配置修改。

已对照本地 Wrangler Preview、远端项目 Preview 配置和上述实际部署绑定，三者一致。六个 namespace 全部与 Production 不同：

| Binding | Preview namespace ID |
| --- | --- |
| `ORIVANE_USER_STATE` | `802af4a8ace549f8b9329b315f767ed0` |
| `ORIVANE_API_CACHE` | `1c3e6e8fa836463b90b61081ff7fa200` |
| `ORIVANE_API_METRICS` | `76daa9dd753949549c0b2b4c0a36bd43` |
| `ORIVANE_ASSET_LOGOS` | `33ac7605091a47ec94205f0f92efad64` |
| `ORIVANE_AI_USAGE` | `62b76fbe72ce444da8a17af8a642d805` |
| `ORIVANE_CLOUD_FORECASTS` | `939f724a3a5449fdb158d3a227be6e19` |

Preview 项目及实际部署均未声明生产邮件、Google/Apple OAuth、AI 或 optimizer 凭据；测试管理员配置匹配 `preview-admin@orivane.test`。Production 的 `ORIVANE_ADMIN_EMAILS` 仍未配置，本轮未补写。只核对凭据名称和存在性，没有读取或输出 secret 值。

账户 Worker 清单仅见既有 `orivane-favorite-optimizer`，未见 Preview 自动任务 Worker；本轮未触发 optimizer、cron 或 GitHub 自动任务，也未修改调度。未宣称已穷尽核验其他平台的全部自动任务。构建使用 Preview 站点地址、同源 API、关闭分析 token 并设置 `ORIVANE_SKIP_SEO_REFRESH=1`。

## 3. 当前代码与管理员核对

以下是工作区已有实现，本轮核对并保留，没有重复重构：

| 文件 | 当前行为及结论 |
| --- | --- |
| `netlify/functions/api.mts` | 管理员依赖有效应用 session 和 `ORIVANE_ADMIN_EMAILS`；名单无默认邮箱，缺失或空值拒绝。`/auth/me` 返回服务端 `is_admin`；现有管理员路由 `/admin/metrics` 独立执行授权。 |
| `lib/admin.ts` | UI 仅接受严格 `is_admin === true`，不按邮箱或客户端角色授权。 |
| `components/auth-provider.tsx` | 退出、身份失效及当前账号管理员 403 触发身份/权限清理；忽略旧账号拒绝事件。 |
| `components/monitor-page.tsx` | 按身份与权限清理监控状态、取消请求，迟到响应不能恢复已退出账号的数据。 |
| `scripts/generate-cloudflare-worker.mjs` | 每次请求独立身份上下文；本轮测试及构建通过生成器更新产物，不手改生成文件。 |

密码维护源仍为 WebCrypto PBKDF2-SHA256 210000 写入及旧 salted SHA-256 验证，尚未替换为目标 scheme。现有格式解析和升级路径尚不能作为用户要求的严格新 verifier 交付；未知版本、损坏/缺失 hash 和失败不升级等完整密码矩阵仍待实现及测试。不能将本轮管理员测试通过解释为密码修复完成。

用户 UUID、`users/${user.id}.json`、KV session 结构、Google/Apple、首页及其他业务代码均未在本轮修改。构建前后 156 个源码/配置文件 SHA-256 比较一致，包括生成 Worker；原有未提交成果保留。

## 4. 本次测试与 Preview 只读核验

本次实际运行结果，非历史结果：

| 验证 | 2026-09-30 结果 | 边界 |
| --- | --- | --- |
| `npm run test:security` | 5 文件 / 63 项通过 | 含生成后的 Worker、本地 Miniflare/workerd、session 失效/不一致/存储查询失败、并发身份、私有 API 与账号隔离测试；不是托管真实登录验收。 |
| `npm test -- --reporter=dot` | 34 文件 / 150 项通过 | 包含 7 项管理员 UI 测试：服务端标记、退出切换、403、会话失效、篡改本地标记、迟到响应、旧账号事件。 |
| `npm run typecheck` | 通过 | 当前工作区。 |
| Preview 环境参数下 `npm run build:cloudflare` | 通过 | 通过维护源生成 Worker；跳过 SEO refresh；没有部署。 |
| Preview `/auth/me` | 未登录及伪造 Bearer JWT 均为 200、空用户 | 伪造 JWT 未取得用户身份。 |
| Preview `/user/state` GET | 两种情况均为 401 | 未访问真实私人数据。 |
| Preview `/admin/metrics` GET | 两种情况均为 403 | 不等于真实普通用户/管理员登录后的完整验收。 |
| Preview `/auth/config` | Google、Apple 均为 false | Apple 保持关闭。 |

只读请求可能产生应用自身的 Preview 访问监控记录；没有直接写 KV，没有注册或修改账号，没有调用生产数据接口或发信。

本次未完成：真实注册 A/B → 退出 → 密码登录 → A/B 切换 → 离线队列隔离 → 普通用户拒绝/管理员 `/monitor` → 退出清理；这些不能由本地 mock 或直接写 KV session 替代。提醒邮件未配置，本轮未取得真实登录 session，因此没有重新验证已登录提醒测试的 `email_unavailable` 分支，更没有测试实际投递；9 月历史结果仍仅是历史结果。

## 5. Benchmark 与兼容性

本次已确认 Free，但安全参数的运行门槛未满足，未重跑密码 benchmark，也未新增托管 benchmark endpoint。以下仅引用 9 月 8 日结果，详见[历史报告](preview-password-admin-status-2026-09-08.md)：

| 候选 | 版本与参数 | 历史本地 CPU/次 | 本次托管 CPU |
| --- | --- | --- | --- |
| Argon2id | `hash-wasm@4.12.0`；静态 WASM；m=19456 KiB, t=2, p=1, 输出 32 B | 约 22 ms | 未测 |
| PBKDF2-HMAC-SHA256 | `@noble/hashes@2.4.0`；600000 iterations，输出 32 B | 约 533 ms | 未测 |

历史环境为 Miniflare 4.20260630.0 / workerd 1.20260630.1、Apple M4 arm64；历史记录有正确性及各 4 并发验证。本轮没有把这些重新标记为当前结果，静态 WASM/上传 bundle/托管 CPU 兼容性仍须在配额满足后重新验收。

尚无新 scheme，因此本轮没有密码兼容性迁移影响，也没有旧 hash 重写。后续必须严格按记录自身 iterations 验证历史 PBKDF2（含 210000），明确 scheme/version/参数，正确验证后才升级；失败、未知格式和缺失记录一律拒绝。

## 6. 修改文件、证据及回退

本轮仅更新文档：

- `Market Analysis.md`：同步当前环境、测试及未完成门槛。
- 本报告：记录 9 月 30 日复核。
- `docs/preview-password-admin-status-2026-09-08.md`、`docs/preview-environment-report.md`：增加历史快照提示及最新报告链接，保留历史内容。

本地忽略目录 `.qa/password-admin-recheck-2026-09-30/` 保存脱敏远端状态、只读 smoke 结果、源码一致性检查及测试/构建日志，不含真实密码记录或 secret 值。

本次无部署、无 schema/账号/session 迁移，因此无需线上回退。需要撤回本轮交付时，只撤回上述新增报告和本轮文档段落；不要重置整个工作区或覆盖原有首页/认证改动。Preview 继续使用上列既有版本。**Production 未部署、未修改配置。**
