# Preview 阻塞问题调查与建议

调查时间：2026-09-08（Asia/Shanghai）。本轮只读取 Cloudflare 配置和生产账号记录结构，创建隔离的本地 benchmark 与本报告。没有修改应用认证代码、PASSWORD_ITERATIONS、项目依赖清单或 Cloudflare 配置，没有部署 Preview / Production，没有写入任何生产 KV。

## 结论

- 推荐后续以固定版本 `@noble/hashes` 的纯 JS PBKDF2 实现兼容旧记录，保留 **210000** 次及现有密码、salt 的 UTF-8 编码方式。这是待批准的实现建议，本轮未接入应用。
- 生产当前实际记录并不是全部 PBKDF2：只读扫描发现 **4 条符合历史 salted SHA-256 结构的记录、1 条空密码记录，0 条带参数的 PBKDF2 记录**。因此不能只修 PBKDF2 而遗漏旧 SHA-256 登录后的升级路径。
- 本地 workerd 已验证候选算法正确性与 CPU 开销。纯 JS 约 **183.5 ms CPU/次**，不适合 Workers Free 的 10 ms 配额。账户实际付费资格/CPU 限额尚未证实；`usage_model=standard` 不能单独作为套餐证明。后续必须先确认配额，再在隔离 Preview 验证托管 CPU，不能把本地通过当作线上通过。
- 管理员 UI 最小方案为后端返回 `is_admin`，前端仅消费该布尔值；API 继续逐请求检查有效 session 和环境名单。生产尚未显式配置 `ORIVANE_ADMIN_EMAILS`，后续删除服务端默认名单前必须先补齐该配置。

## A1. 生产密码记录结构

从 Pages 当前 Production 配置解析 `ORIVANE_USER_STATE`，完整分页读取 `auth/users/` 前缀：1 页、5 条、读取失败 0。账号内容只在内存中归类，未保存原始记录，也未输出真实 hash、salt、邮箱、UUID 或姓名。扫描反映调查时刻，不是 KV 的事务快照。

| 项目 | 实际结构 |
| --- | --- |
| 账号基础字段 | 5 条均存在字符串 `id`、`email`、`created_at` |
| 密码字段 | 5 条均存在字符串 `salt`、`password_hash` |
| 旧密码记录 | 4 条：`password_hash` 是规范 Base64，解码长度 32 字节；`salt` 为 36 字符 UUID v4 格式 |
| 空密码记录 | 1 条：`salt`、`password_hash` 均为空；存在 provider 字段；应归类为无密码登录资格 |
| PBKDF2 记录 | 当前扫描未发现 `pbkdf2_sha256$...` 格式 |
| 独立算法/版本参数 | 所有记录均无 `scheme`、`version`、`algorithm`、`iterations`、`password_scheme`、`password_version` 字段 |

现有代码将无前缀记录按 `Base64(SHA-256(UTF8(salt + ':' + password)))` 验证。因此上述 4 条的存储结构符合该历史格式。**hash 的外观本身不能证明算法；本次没有取得明文密码，也未尝试验证真实用户密码。**

当前 PBKDF2 writer 和 verifier 使用以下约定，未来必须保持兼容：

- `password_hash = pbkdf2_sha256$<iterations>$<salt-string>$<base64-digest>`，恰好 4 段；HMAC-SHA-256，32 字节输出。
- 默认 iterations 为 **210000**，实际验证参数从记录读取。
- password 和 salt 都直接做 UTF-8 编码；salt 不是 Base64 解码后的内容，也不是 UUID 解析后的 16 字节。
- 顶层 `salt` 是同一 salt 的冗余字段；PBKDF2 计算以编码串中的 salt 为准。
- 现有登录代码在旧密码验证成功后，会生成 210000 次的新密码记录。现有 Preview 的原生 PBKDF2 上限因而同时影响注册、PBKDF2 登录及 SHA-256 登录后的升级。

参考源码：`netlify/functions/api.mts` 中 `authStore`、`legacyPasswordHash`、`passwordHash`、`verifyPassword` 和 `/auth/login`。保留既有账号 UUID、`auth/users/...`、`users/${user.id}.json` 和 session 结构。

## A2. 实际 workerd benchmark

运行环境：Apple M4 / arm64，Darwin 25.6.0；Node 26.0.0 仅负责驱动测试与生成独立 oracle；算法实际运行于 **Miniflare 4.20260630.0 / workerd 1.20260630.1**，兼容日期 `2026-07-01`，`nodejs_compat`。无 KV binding，禁止出站请求，未启用 unsafe eval。

固定候选版本：`@noble/hashes@2.4.0`、`hash-wasm@4.12.0`。依赖只安装在 `.qa/password-investigation/`，未改根项目依赖。

每次派生采用 210000 次 PBKDF2-HMAC-SHA-256、32 字节输出。单候选先预热 3 次，再执行 30 次独立请求统计 wall time；另在单请求内做 20 次派生，读取该 workerd 子进程的累计 CPU 差值。CPU 为操作系统统计的 user + system 时间，含运行时/辅助线程开销，分辨率 10 ms，批量摊销约 0.5 ms/次；**不是 Cloudflare 计费 CPU，也不是单请求 CPU 的 p95**。父进程单调时钟测 wall time，避免 Worker 内部计时器冻结造成误判。

| 实现 | 第一请求 wall ms¹ | warm p50 / p95 ms | CPU ms/次² | 测试 bundle / gzip 字节³ | 结论 |
| --- | ---: | ---: | ---: | ---: | --- |
| noble 2.4.0 纯 JS | 198.6 | 185.4 / 187.1 | 183.5 | 8886 / 3810 | 正确，推荐候选 |
| hash-wasm 4.12.0 原包 | — | — | — | — | 动态编译 WASM 被拒绝 |
| hash-wasm 静态模块加载实验 | 263.3 | 283.5 / 287.1 | 284.5 | 30928 / 11700 | 正确，但更慢且需维护加载适配 |
| 原生 WebCrypto 对照 | 15.6 | 14.2 / 14.7 | 13.0 | 668 / 433 | 仅本地通过，不能据此判断托管可用 |
| workerd `node:crypto` 对照 | 15.4 | 13.8 / 14.2 | 13.0 | 539 / 356 | 同样不能据此绕过托管上限 |

¹ Miniflare ready 后首个请求，包括首次派生初始化；不是部署/启动耗时。² 20 次派生的批量均值。³ 独立最小测试入口大小，含验证包装；不是整个应用部署包的增量保证。WASM 行包含静态 WASM 模块，未额外优化重复嵌入的数据。

验证结果：

- 使用 Node 原生 `pbkdf2Sync` 独立生成合成样本 oracle；覆盖 ASCII + UUID salt、Unicode、长密码与看似 Base64 的 salt、内嵌 NUL、100000 次独立控制组。
- noble、静态加载 hash-wasm 和两种原生对照，各自 5 个正确样本全部一致；错误密码以及**将 210000 次 digest 按 100000 次计算**均不匹配。共 **28/28 个预期结果**。
- 4 个可运行候选分别在同一 workerd 上并发发起 4 组不同输入，**4/4 组结果正确**。noble 一组并发 wall 741.8 ms / CPU 740 ms；静态 hash-wasm 1157.2 ms / 1150 ms。这证明本测试无输入混用，不代表 CPU 工作在单 isolate 中并行，也不替代应用 session 并发测试。
- 原版 hash-wasm 明确报 `WebAssembly.compile(): Wasm code generation disallowed by embedder`。实验只把库的加载步骤替换为静态 `CompiledWasm` 导入，保留上游 WASM 字节和全部密码学循环；没有自行实现 PBKDF2/SHA/HMAC。该加载适配不是原包开箱即用能力。
- 本轮没有实现 versioned verifier，因此未声称 scheme 分派、登录升级或管理员 UI 已通过端到端测试。

可复现入口：`node .qa/password-investigation/benchmark.mjs`；依赖版本及锁文件位于同目录。匿名生产统计见 `production-structure.json`，完整 benchmark 见 `benchmark-results.json`。

### CPU 与托管兼容性边界

Cloudflare 官方目前列出 Workers Free 每请求 CPU 10 ms、Paid 默认 30 秒，可配置上限 5 分钟；Pages Functions 计入 Workers 使用额度。[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)、[Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/)。

生产项目及 Workers account settings 都返回 `standard` usage model；读取账户 subscription 资格未成功，项目未返回明确 CPU override。因此本次不能确认实际套餐与有效配额，也未修改套餐或配额。

本地原生 API 虽快且允许 210000 次，独立 workerd server 源码明确对 PBKDF2 不设次数上限；托管默认限制实现是 100000，`node:crypto` 也调用同一限制检查。第一轮 Preview 已记录 210000 次被托管拒绝。本地通过不能推翻该托管证据，更不能简单切换到 `node:crypto` 就宣布解决。[workerd server](https://raw.githubusercontent.com/cloudflare/workerd/main/src/workerd/server/server.c%2B%2B)、[默认限制](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/limit-enforcer.h)、[node crypto 检查](https://raw.githubusercontent.com/cloudflare/workerd/main/src/workerd/api/node/crypto.c%2B%2B)。

推荐 noble 的原因是无 WASM 加载适配、固定依赖、当前测量更快且包较小。该库有独立审计历史，但公开的 Cure53 审计针对 **1.0.0（2022）**，不能说本次测试的 2.4.0 已经完成同样审计。[noble 项目与审计说明](https://github.com/paulmillr/noble-hashes)。WASM 要使用预编译模块，原包嵌入 Base64 后动态编译的方式不符合 Worker 当前限制。[Cloudflare WASM](https://developers.cloudflare.com/workers/runtime-apis/webassembly/)、[hash-wasm 项目](https://github.com/Daninet/hash-wasm)。

本地结果显示两种非原生实现均不能按 10 ms 预算设计。若实际环境为 Paid 且有足够 CPU 预算，它们在本机测量上有余量，但这仍需后续隔离 Preview 的真实 CPU/wall/error 指标确认。不得用调低 iterations、拆分成错误的 PBKDF2 计算、或切换身份 fallback 解决预算问题。本轮不切换算法家族、不迁移 Durable Objects、不增加认证服务。

## A3. 建议的 versioned verifier（尚未实现）

采用“先识别格式、严格校验元数据、只执行指定 verifier、失败终止”的流程，不用 try 一个算法再试另一个。

| 记录类型 | 识别与分派 | 写入策略 |
| --- | --- | --- |
| 历史 SHA-256，隐式 v0 | 无版本/方案字段；hash 必须是规范 32 字节 Base64；salt 是有效非空字符串。只执行历史 SHA-256 验证 | 禁止生成新 v0；只有验证成功后才允许升级 |
| 现有 PBKDF2，隐式 v1 | 无版本/方案字段；精确 `pbkdf2_sha256` 前缀与 4 段格式；只按记录 iterations、UTF-8 salt、32 字节输出验证 | 210000 次记录不因更换实现而重写 |
| 新 PBKDF2，显式 v1 | 保留原 `password_hash` 编码，新增 `password_scheme: "pbkdf2_sha256"`、`password_version: 1`，两者与编码必须一致 | 新注册/获批准的成功登录升级使用 210000 次；顶层 salt 保持一致 |
| 空密码、未知版本/方案、格式损坏 | 拒绝密码登录；不得进入历史 SHA-256 或其他算法分支 | 不写入，不创建 session |

这是最小版本化方案：不需要换掉既有 hash 字符串，也不批量补字段。新增字段仅用于新密码写入，旧记录可按现有唯一格式识别。相同算法和参数由 WebCrypto 换为 noble 不构成新密码 scheme，因此不人为制造 v2。未来若需要新方案，再添加显式新版本和独立 verifier。

具体校验建议：

1. 版本字段存在时先严格分派；只存在其中一个字段、版本类型不符、未知版本、算法标签冲突，一律拒绝，不尝试旧格式。
2. PBKDF2 迭代数必须为规范正整数，拒绝小数、科学计数法、负值、零、NaN 和无穷大；必须设受支持的最大计算预算。初始建议支持 `1..210000` 的旧 v1 参数，实际逐条按记录值计算，新写入固定 210000。这保留当前 writer 能生成的记录范围及低于当前参数的历史升级路径；超过边界时明确拒绝而非截断，后续确需支持更高参数时先扩展测试和预算。
3. 严格检查段数、salt 非空及合理长度、Base64 规范编码、32 字节 digest；password 与 salt 均按原始 UTF-8 编码，不做 trim、Unicode 归一化或隐式 Base64 decode。现有 PBKDF2 以编码内 salt 为权威；新显式 v1 同时检查冗余顶层 salt 一致。
4. 用成熟运行时的 `timingSafeEqual` 比较等长派生字节；不自行编写密码学或比较算法。验证异常/失败只返回失败，不 fallback；不记录密码、hash 或 salt。
5. KDF 输入、派生状态和请求依赖均为调用局部变量；不跨请求缓存密码派生结果、用户、session 或 env。
6. 只有 `valid === true` 才能考虑升级。推荐延续当前“v0/低参数成功验证后升级到 210000”的意图；必须先成功生成完整新 hash，再保存，升级失败不写半成品。本阶段保持失败关闭，不因 KDF/存储异常另发 session。
7. 不批量改写；210000 的 v1 不因缺少显式标签而反复 rehash。KV 不支持事务性 compare-and-swap，本方案不声称消除登录升级与同时密码修改之间的竞态；不在本轮混入 KV 架构迁移。

兼容性影响：原密码、UUID、用户路径和 session 格式不变。新显式 v1 仍保留老 PBKDF2 字符串，因此旧解析器能读其格式；但**回滚到托管原生 WebCrypto 版本仍会重新触发 100000 上限**，不能把“字段向后兼容”当作“旧运行时代码可安全回滚”。首次旧密码成功登录升级会增加一次完整 KDF 开销；当前 PBKDF2 高参数记录正常登录只需一次。新参数并未降低，也未声称 210000 是未来最终安全参数。

实施后的必要验收：v0 正确/错误密码；未标记的 210000 v1；显式 v1；不同记录 iterations；不规范参数和未知版本；100000 不能验证 210000 digest；异常不能 fallback/创建 session；失败登录零写入；升级只发生在成功验证后且旧 v1 不重写；并发不同用户；注册→登录→`/auth/me`→私有 API；托管 Preview CPU 指标。当前仅候选算法部分已执行。

## B. 管理员前后端一致性的最小方案

现状：

- `lib/admin.ts` 硬编码邮箱，`components/monitor-page.tsx` 和 `components/header.tsx` 通过 `isAdminUser` 使用它。
- 后端 `requireAdmin` 从经过验证的 cookie session 获取用户，再查询服务端名单；当前仅发现一个 `/api/admin/*` 路由：`GET /api/admin/metrics`，已有独立授权检查。
- `adminEmails()` 在缺少 `ORIVANE_ADMIN_EMAILS` 时回退到硬编码名单。Production 当前未显式配置该变量，Preview 已配置测试管理员名单；这也是未来必须消除的权限真源。

建议修改范围：

| 文件/位置 | 后续最小修改 |
| --- | --- |
| `netlify/functions/api.mts` | 后端 AuthUser 投影增加 `is_admin`；有效 session 的 `/auth/me` 和创建 session 成功后的登录/注册响应统一计算。`adminEmails()` 只读当前请求 env 的 `ORIVANE_ADMIN_EMAILS`，缺失/空白时返回空名单，拒绝授权 |
| 同文件 `/api/admin/metrics` | 保留逐请求 `requireAdmin`，忽略客户端提交的 is_admin/role/header/body；所有未来 `/api/admin/*` 也必须有服务端检查，不因本次 UI 改动放开任何 API |
| `lib/types.ts` | AuthUser 增加 `is_admin?: boolean`，兼容旧响应；字段缺失默认 false |
| `lib/admin.ts` | 删除硬编码 `ADMIN_EMAILS` 及 email 判断；保留 `isAdminUser` API，但仅检查 `user?.is_admin === true` |
| `components/monitor-page.tsx` | 使用同一个 helper；身份未验证、切换/退出、权限撤销及 401/403 时隐藏并清空旧 metrics，丢弃旧请求的迟到结果 |
| `components/header.tsx` | 现有 helper 调用可保持，通过新 helper 控制入口显示 |
| 相关测试 | 扩展已有 Worker 授权测试，并补前端后端角色标记测试；不改业务功能 |

`AuthProvider` 当前只从后端 `/auth/me` 或登录响应建立用户；localStorage 仅保存跨标签通知所需 user ID。沿用这一行为，不把 `is_admin` 从 localStorage/JWT/body 恢复为权限事实，不把角色固定写入 KV session。后端每次按当前环境计算；继续使用私有、不可缓存的 auth/admin 响应。前端字段只是 UI 提示，API 永远独立授权。

建议顺序：先在未来获准的环境配置步骤中显式配置名单，Preview 用测试管理员、Production 用经确认的正式管理员；随后才移除服务端默认名单。**本轮不配置 Production。** 缺失配置必须 fail closed，不能为避免锁出保留 fallback。

验收应覆盖：测试管理员邮箱不在任何旧前端名单仍显示 `/monitor`；非管理员即使篡改 UI/localStorage/请求的 `is_admin=true`，API 仍返回 403；过期或无效 session 无权限；移除服务端名单后下一次 API 请求拒绝；退出/切换账户时旧监控数据不闪现；未知字段/旧后端响应默认无管理员 UI。

## 本轮交付与边界

- 新增本报告，以及被 git 忽略的 `.qa/password-investigation/` 调查脚本、依赖锁文件和匿名结果。
- 开始/结束逐文件 SHA-256 对照确认：本轮 **已有 tracked 文件改动 0**，包含认证实现、生成器、根 package 文件和部署配置。
- 只进行了 Cloudflare GET 读取；Production 部署 ID 和配置指纹在调查前后保持一致。没有调用任何部署或 KV 写操作。
- 未修改 Google、Apple、邮箱验证、OAuth state、CSRF、Cloudflare Access、KV session 或 Durable Objects。
- 下一步等待对方案的决定；当前不视为认证 blocker 已修复，也不作为 Production 发布许可。
