# Preview 密码与管理员修复状态

> 历史快照。2026-09-30 的重新核验见 [最新状态报告](preview-password-admin-status-2026-09-30.md)。下文套餐与 benchmark 仅代表 9 月 8 日，不是本次验证；9 月 30 日用户截图重新确认当前为 Free，适用官方 10 ms CPU/request，仍未进行新部署。

2026-09-08，Asia/Shanghai。**管理员修复已完成本地验证；密码接入与 Preview 部署因 Workers Free 配额而停止。没有部署 Production，也没有改动远端配置或 KV。**

## 已确认的阻塞原因

在已登录的 Cloudflare 控制台，进入本项目所属账户的 **Workers plans** 页面，**Free** 卡片标记 **Current plan**，CPU 限额为 **10 ms/request**。这是 Workers 套餐的直接证据，不是域名套餐，也不是根据 `usage_model=standard` 推断。未进入账单/支付页面、未读取付款信息、未执行套餐升级。

按照本轮指令第 10 条，不采用 CPU 明显超过该配额的密码方案，不降低安全参数以迁就 Free。后续线上 benchmark、当前 scheme 的接入、完整登录链路及 Preview 重部署需要先解决 CPU 配额。

## 两个当前密码候选的本地 benchmark

实际运行于 Miniflare **4.20260630.0** / workerd **1.20260630.1**，Apple M4 / arm64；兼容日期 `2026-07-01`，`nodejs_compat`。测试环境无 KV、无外部网络、无 unsafe eval。密码与 salt 都是合成输入。

| 候选 | 固定参数 | warm wall p50 / p95 | 本地 CPU/次 | 独立测试 bundle / gzip |
| --- | --- | ---: | ---: | ---: |
| hash-wasm **4.12.0** Argon2id，静态 WASM 加载 | m=19456 KiB，t=2，p=1，32 字节输出 | 25.25 / 27.44 ms | **22 ms** | 43212 / 17143 字节 |
| @noble/hashes **2.4.0** PBKDF2-HMAC-SHA256 | 600000 iterations，32 字节输出 | 528.91 / 561.56 ms | **533 ms** | 8886 / 3810 字节 |

- 每候选预热 3 次，测量 30 次独立请求；CPU 通过 20 次批量派生的 workerd 子进程 CPU 差值摊销，分辨率 10 ms。它包含运行时开销，**不是 Cloudflare 计费 CPU**。wall 使用父进程单调时钟，不依赖 Worker 内冻结计时器。
- Argon2id 仅替换上游库的 WASM 加载步骤：原样提取 `argon2`、`blake2b` 二进制，通过 `CompiledWasm` 静态导入；密码学算法、WASM 字节和循环都来自固定版本库，没有自行实现密码学。
- Argon2id 的独立 oracle 使用 Node 26 原生 `argon2Sync`；PBKDF2 使用 Node 原生 `pbkdf2Sync`。包含 ASCII、Unicode、长密码、NUL 的样本均一致；错误密码不匹配。PBKDF2-600000 的 digest 按 100000 次计算也不匹配。
- **13 个预期校验结果全部符合，2 个候选各自的四请求并发组均正确。** Argon2id 中同输入的额外控制样本仍固定 t=2，并未测试改变参数。
- 本机结果优先支持 Argon2id，但它仍超过 Free 的 10 ms 配额。**尚未执行托管 Preview benchmark，所以不宣称 Cloudflare 托管 CPU、内存和部署稳定性已验收。**

复现：在 frontend 目录运行 `node .qa/preview-current-password/benchmark.mjs`。固定依赖沿用 `.qa/password-investigation/package-lock.json`；完整数据位于 `.qa/preview-current-password/benchmark-results.json`。这些实验文件被 git 忽略，没有加入应用依赖。

参数与限制依据：[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)、[Cloudflare WASM](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)。

## 已完成的管理员修改

| 文件 | 修改 |
| --- | --- |
| `netlify/functions/api.mts` | `publicAuthUser` 返回根据当前请求环境计算的 `is_admin`；`adminEmails()` 删除硬编码默认邮箱，环境变量缺失/空白时名单为空。保留 `/api/admin/metrics` 的独立有效 session 授权 |
| `lib/types.ts` | AuthUser 增加可选 `is_admin`，旧响应缺少字段时 UI 默认无权限 |
| `lib/admin.ts` | 删除前端邮箱名单和 email 授权判断；仅严格接受 `is_admin === true` |
| `components/auth-provider.tsx` | 私有 API 返回 401 后重新验证当前 cookie；管理员 API 403 后撤销相应当前用户的 UI 权限；旧账号的拒绝结果不改变新账号身份 |
| `lib/api.ts` | 管理员请求支持取消及显式请求所属用户标记；401/403 通知 AuthProvider。标记由当前已验证用户传入，仅用于清理旧请求，不是服务端授权来源，不从 localStorage 获取权限 |
| `components/monitor-page.tsx` | 身份/验证状态/管理员状态变化时重建组件，清除敏感监控数据；取消未完成请求，忽略迟到结果 |
| `components/admin-access.test.tsx` | 新增 7 项 UI 授权与清理测试 |
| `tests/cloudflare-auth.test.ts` | 增加后端角色投影、缺失/空白名单拒绝及客户端伪造权限不生效的测试 |
| `functions/api/[[path]].ts` | 由现有生成器重新生成对应 Worker，非手工维护文件 |

Header 继续调用现有 `isAdminUser` helper，自动使用后端标记，不需要另一份权限名单。角色没有写入 localStorage 或 session/KV；`ORIVANE_ADMIN_EMAILS` 与有效应用 session 是服务端权限依据。客户端修改 `is_admin` 或 header 不能授予 API 权限。

退出与账号切换沿用第一阶段清空当前用户的行为；监控组件随该状态销毁，旧数据不会在下一账号恢复。私有请求的 401 触发一次新的 `/auth/me` 检查；`/auth/me` 自己失败不会递归触发检查。

Preview 已有测试管理员名单及六个独立 KV binding，本轮确认未引用任何 Production KV。Production 仍未显式配置管理员名单，因此本地修改不得直接部署 Production，否则管理员入口会按设计拒绝授权。

## 验证与未完成项

已完成：

- 全量测试 **33 个文件 / 142 项通过**，含生成后的 Cloudflare Worker 与实际 workerd session 测试。
- 新增管理员测试覆盖：仅后端布尔值有效；退出→B 登录清理；403 撤权；session 失效重验；篡改 localStorage marker 不能阻止撤权；旧成功响应迟到不恢复数据；旧用户拒绝事件不改变新账号身份。
- 类型检查通过；Cloudflare 构建通过，SEO refresh 显式禁用。构建没有部署任何环境。
- `git diff --check` 通过。
- Cloudflare Production 的部署 ID、配置指纹与本轮开始时一致；本轮远端写操作和部署次数均为 0。

由于已确认 Free，以下尚未完成，不能视为已交付：

- Argon2id / PBKDF2-600000 的托管 Preview benchmark 与最终 scheme 选择。
- 当前密码 scheme 的明确版本/参数格式、严格 legacy verifier、成功登录后升级及相关应用测试。
- 注册→退出→密码登录→A/B 真登录切换→`/monitor` 的完整线上 smoke test。
- Preview 重部署。

现有密码实现未被替换，没有把 210000 作为本轮的新 scheme，也没有把任何历史记录改写为较低参数。Google、Apple、CSRF、Cloudflare Access、Durable Objects 和 KV session 架构未修改。

继续时先核验可用的 Workers CPU 配额；若具备足够配额，再以本次更快的 Argon2id 为优先候选完成托管验证。只有验证后才接入当前密码格式；210000 PBKDF2 仍仅作为历史兼容要求。没有获得套餐升级授权，本轮未执行升级。
