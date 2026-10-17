# 第一阶段认证安全修复报告

日期：2026-09-06（Asia/Shanghai）。范围：本地修改与测试；未部署生产、未迁移历史数据。

## 已实现

- 普通用户身份只接受应用 Cookie session。Authorization Bearer、Access assertion、未验证 JWT claim 均不能作为回退身份。
- 严格检查 Cookie token 非空、对应 session 存在且 token 相符、有效期合法且未到期、账号存在、session.user_id 与 account.id 相等、session.email 与 account.email 相等。存储或解析失败按未登录处理。
- 移除 Worker 请求/环境全局变量和认证内存兜底。createApi 接收当前请求的环境、存储与邮件依赖，异步回调也保留本次请求的绑定。公共静态目录数据仍可共享。
- 普通用户客户端请求仅通过 credentials: include 携带 Cookie；删除旧 token 读取和发送，启动不信任本地缓存用户信息。
- user-state、favorites、AI/研究状态、浏览记录、对比草稿、访问快照和离线 patch 按 userId 隔离；访客独立 namespace。旧未绑定数据不自动导入。
- 账号切换会终止旧 user-state 请求、停用旧存储句柄和计时器；请求携带 x-orivane-user-id 作为匹配护栏。即使 Cookie 已变成 B，A 的旧 patch/删除/退出请求也不能操作 B。该 header 不用于认证。
- 现有 UUID、users/${user.id}.json 路径、session 数据字段和 KV session store 保持不变。机器任务的 optimizer token / GitHub OIDC 鉴权保留。

## 验证结果

- 全量 `npm test`：32 个测试文件，134 / 134 通过；其中 62 项专项安全回归。
- `npm run typecheck`：通过；最终 Next.js 构建也完成 TypeScript 检查。
- `ORIVANE_SKIP_SEO_REFRESH=1 npm run build:cloudflare`：通过，113 个页面。跳过生产 SEO API 刷新，未修改市场快照。
- `WRANGLER_SEND_METRICS=false npx wrangler pages functions build functions --outdir .qa/auth-phase1-worker --compatibility-date=2026-07-01 --compatibility-flags=nodejs_compat`：Worker 编译通过。
- `git diff --check`：通过。

| 验收项 | 结果与测试边界 |
| --- | --- |
| 任意伪造 Bearer JWT 无法登录 | 普通身份不读取 Bearer；伪 JWT 访问所有私有路由均拒绝；Access header/cookie 不成为普通用户。 |
| session 缺失/无效/过期/查询失败 | 覆盖缺失、格式错误、非法有效期、过期、token 不匹配、KV 缺失、session/账号读取异常。 |
| 用户 ID、email 一致性 | ID 不一致、邮箱不一致、账号不存在、缺失身份字段均拒绝。 |
| 并发请求隔离 | 相同 token 在不同 env/KV 中分别认证；延迟 KV 读取、邮件凭据、管理员配置、edge-cache waitUntil 指标不串环境。workerd 内另验证两个普通用户并发写入。 |
| A 退出后登录 B | React 集成测试验证没有 A 的状态/收藏展示或上传；迟到响应无效；IndexedDB 与 fallback 队列只读取当前 owner。 |
| 有效 session 与正常路由 | 覆盖邮箱注册/登录、/auth/me、用户状态 GET/PUT/PATCH、账号删除、退出、提醒测试、管理员权限和 forecast run。完整预测生成与持久化使用明确的本地行情夹具。 |
| 本地运行时 | workerd 使用本地 KV，禁用外网；邮件/行情在路由测试中使用 mock，不实际发信或调用生产 API。前端使用 React/jsdom 和 fake-indexeddb。 |

可复现专项命令：`npm run test:security`。该命令先重新生成 Worker，避免测试过期生成文件。

## 修改文件

| 文件 | 修改内容 |
| --- | --- |
| [netlify/functions/api.mts](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/netlify/functions/api.mts>) | Session 仅从 Cookie 获取；严格校验 token、有效期、账号、user_id 和 email；请求依赖 factory；状态/删除/退出的预期用户护栏。 |
| [scripts/generate-cloudflare-worker.mjs](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/scripts/generate-cloudflare-worker.mjs>) | 删除未经验证的 JWT fallback、ACTIVE_REQUEST、ACTIVE_ENV、内存 KV 兜底；按请求创建存储和邮件适配器；生成替换失败时中止。 |
| [lib/api.ts](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/lib/api.ts>) | 删除旧 Bearer 读取/发送；Cookie credentials；私有 GET 不共享在途结果；预期 userId 与取消信号；只保留跨标签页账号标记。 |
| [components/auth-provider.tsx](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/components/auth-provider.tsx>) | 启动和跨标签页变化时验证 session；登录/退出/删除期间隐藏旧账号；取消过时认证结果；删除清理当前账号本地数据。 |
| [components/providers.tsx](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/components/providers.tsx>) | 按身份重建私有状态边界；取消旧请求与计时器；按 owner 同步队列；保留离线初始读取失败期间的新编辑。 |
| [lib/private-storage.ts](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/lib/private-storage.ts>) | 新增捕获 userId 的私有 localStorage namespace，退出后的旧句柄不可写入。 |
| [lib/offline-store.ts](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/lib/offline-store.ts>) | 离线队列按 userId 使用独立 IndexedDB 数据库及 fallback key；条目校验 owner；忽略无归属旧队列。 |
| [components/dashboard.tsx](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/components/dashboard.tsx>) | 最近资产与对比草稿按用户隔离。 |
| [components/landing-page.tsx](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/components/landing-page.tsx>) | 首页最近资产、对比草稿读取当前用户 namespace。 |
| [components/research-habit-card.tsx](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/components/research-habit-card.tsx>) | 研究习惯统计按用户隔离。 |
| [components/daily-research-brief.tsx](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/components/daily-research-brief.tsx>) | 复核完成记录写入当前用户 namespace。 |
| [components/watchlist-change-summary.tsx](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/components/watchlist-change-summary.tsx>) | 关注行情访问快照按用户隔离；旧异步回调不可落盘。 |
| [components/detail-panel.tsx](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/components/detail-panel.tsx>) | 移除未绑定用户的旧 AI 聊天记录自动导入。 |
| [components/portfolio-page.tsx](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/components/portfolio-page.tsx>) | 移除未绑定用户的旧组合 AI 聊天记录自动导入。 |
| [components/providers.test.tsx](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/components/providers.test.tsx>) | 保留主题、语言、收藏测试；明确等待认证初始化。 |
| [components/account-isolation.test.tsx](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/components/account-isolation.test.tsx>) | 账号 A→退出→B、迟到读取/保存响应、未验证身份、离线初始读取失败时的数据保留。 |
| [lib/private-storage.test.ts](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/lib/private-storage.test.ts>) | localStorage、IndexedDB 和 fallback 队列 owner 隔离。 |
| [lib/api-auth.test.ts](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/lib/api-auth.test.ts>) | 普通请求和 SSE 不发 Bearer；私有请求不混用；预期账号护栏与旧凭据清理。 |
| [tests/cloudflare-auth.test.ts](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/tests/cloudflare-auth.test.ts>) | 直接测试生成的 Pages onRequest：认证、所有私有路由、邮件、管理员、预测、不同 env/KV 的确定性交错并发。 |
| [tests/cloudflare-runtime.test.ts](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/tests/cloudflare-runtime.test.ts>) | Miniflare/workerd 实际本地 Worker 运行时及本地 KV：拒绝伪 JWT、无效 session、并发隔离与旧用户 patch。 |
| [package.json](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/package.json>) | 测试前自动生成 Worker；新增 test:security；移除 @netlify/identity；声明测试依赖。 |
| [package-lock.json](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/package-lock.json>) | 锁定相应依赖变更；esbuild/Miniflare 沿用已安装版本，新增 fake-indexeddb 测试依赖。 |
| [docs/security-phase-2.md](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/docs/security-phase-2.md>) | 第二阶段加固事项，明确本阶段不实施。 |
| [docs/security-phase-1-report.md](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/docs/security-phase-1-report.md>) | 本次本地变更、验证和兼容性报告。 |

此外重新生成了 [functions/api/[[path]].ts](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/functions/api/[[path]].ts>)；该文件原本即由 .gitignore 排除，发布时由生成器构建。源文件和生成器均已修改，不能只复制生成文件。

## 潜在兼容性影响

1. 仅持有旧 Bearer token 的普通用户/API 客户端需要通过应用登录重新取得 Cookie；机器任务 token 不受此限制。
2. 旧未绑定用户的本地收藏、聊天和离线队列不再自动展示或上传。旧数据未进行历史迁移；已有云端数据仍从原 UUID 路径读取。
3. 历史损坏或不一致的 session 会失效，需要重新登录；合法的现有 session 无需统一退出。
4. 缺少 KV binding 时不再静默使用模块内存。session 查询失败视为未登录，创建或写入失败会返回错误。
5. 原跨请求内存 memo/inflight cache 收敛为请求内；已有 KV 与 edge cache 继续使用，可能增加 KV 读取或重复计算。未测量生产性能。
6. 认证重验/切换期间暂时隐藏旧用户私有状态；主题与语言继续作为设备偏好保留。离线 patch 留在原用户 namespace，只能随该用户后续认证恢复。
7. 当前 KV 的最终一致性限制仍在，因此未承诺生产跨区域立即撤销或原子并发写入。

## 第二阶段

Apple JWT 验签、Google email_verified、邮箱所有权验证、OAuth state/nonce/PKCE、CSRF、Cloudflare Access admin/staging，以及 KV 撤销一致性和完整删除流程单列在 [第二阶段清单](</Users/icehacker/Documents/Market Analysis/股票预测/frontend/docs/security-phase-2.md>)。本阶段没有引入 Durable Objects，也没有新增 Cloudflare Access 普通用户认证。
