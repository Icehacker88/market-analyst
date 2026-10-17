# Preview 环境配置与 smoke test 报告

> 下文为 2026-09-06 历史验收。2026-09-30 已重新确认六个实际 KV binding 与 Production 隔离、Preview 无生产凭据声明，当前部署为 `ff7fd40d-0258-4689-950f-0509aaff1937`。本地管理员实现已修复并重跑测试，但真实密码登录及 `/monitor` 完整验收仍未完成；旧 session 夹具结果不可替代。用户本次截图已确认 Workers Free，适用官方 10 ms CPU/request，密码接入及部署继续停止。详见 [最新状态报告](preview-password-admin-status-2026-09-30.md)。

日期：2026-09-06（Asia/Shanghai）。本轮仅配置并部署 Preview，没有部署 Production，也没有修改认证实现。

## 结果

- Preview 已部署：https://codex-auth-phase1-preview.orivane-market-intelligence.pages.dev
- 固定部署地址：https://0b1078e3.orivane-market-intelligence.pages.dev
- 部署 ID：`0b1078e3-9713-4fc4-ab22-dee978239580`；Cloudflare 返回 environment=`preview`、status=`success`、branch=`codex/auth-phase1-preview`。
- 六个 KV 全部独立；部署记录中的实际绑定、本地 Wrangler Preview 配置、远端 Preview 配置三者一致。
- Production 部署 ID 始终为 `2bf56aeb-0e72-4c19-8cb5-f4926cd25725`，Production 配置指纹未变。对本轮 A/B/管理员/删除测试账号的 UUID 数据键和账号键进行生产 KV 精确前缀检查，匹配数均为 0。
- **Smoke test 部分通过，尚不能作为生产发布验收通过。** 邮箱注册/密码登录存在托管 Worker 的 PBKDF2 限制问题；测试管理员 API 正常，但前端管理员页面仍使用硬编码名单。两处认证相关实现均未在本轮修改。

## 初始风险与处理

检查时，Cloudflare 没有现存 Preview 部署，Preview KV 和环境变量均为空。原 Wrangler 顶层声明的是六个生产 KV；如果直接使用原配置部署非生产分支，会将这些绑定用于 Preview。

已创建六个专用 Preview namespace，先配置远端 Preview，再添加 `env.preview` 的完整 KV 和变量覆盖；部署前校验所有 Preview namespace ID 均不属于生产集合。Cloudflare Pages 的环境配置规则见 [官方文档](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)。

## Binding 对照

Production 的 namespace 名称与 binding 同名；Preview 名称在 binding 后增加 `_PREVIEW`。这些 ID 是资源标识，不是 secret。

| Binding | Production namespace ID（未改动） | Preview namespace ID |
| --- | --- | --- |
| ORIVANE_USER_STATE | f910a1b2d0db4cd2aac0c28c152a089f | 802af4a8ace549f8b9329b315f767ed0 |
| ORIVANE_API_CACHE | 952c1a561f814b319fd0cd4eccef8ad7 | 1c3e6e8fa836463b90b61081ff7fa200 |
| ORIVANE_API_METRICS | b8c63871bb714ce5bda77b3e7675472d | 76daa9dd753949549c0b2b4c0a36bd43 |
| ORIVANE_ASSET_LOGOS | ae83b61ba0014837916c30c10f65174d | 33ac7605091a47ec94205f0f92efad64 |
| ORIVANE_AI_USAGE | 071c16b453744762a683723760d2ec29 | 62b76fbe72ce444da8a17af8a642d805 |
| ORIVANE_CLOUD_FORECASTS | ad46e096b1e3450485200e76ed56916a | 939f724a3a5449fdb158d3a227be6e19 |

## Environment variable 对照

只记录名称和配置状态，不展示 secret 值。生产 secret 的“存在”来自 Cloudflare 返回的声明元数据，不代表本轮测试了凭据有效性。

| 变量 | Production | Preview |
| --- | --- | --- |
| ORIVANE_MARKET_DATA_PROVIDER | 保留现有配置 | free-yahoo-eastmoney |
| ORIVANE_AI_DAILY_LIMIT | 保留现有配置 | 2 |
| ORIVANE_ADMIN_EMAILS | 未单独配置，使用现有代码默认名单 | preview-admin@orivane.test |
| GEMINI_API_KEY | 存在 secret 声明 | 未配置；AI 外部生成关闭 |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | 存在 secret 声明 | 未配置；Google 登录关闭 |
| APPLE_CLIENT_ID / APPLE_CLIENT_SECRET | 无声明；用户确认未启用 | 未配置；Apple 登录关闭 |
| RESEND_API_KEY / ORIVANE_EMAIL_FROM | 存在 secret 声明 | 未配置；外发邮件关闭 |
| ORIVANE_OPTIMIZER_TOKEN | 存在 secret 声明 | 未配置；自动任务凭据关闭 |
| ORIVANE_SKIP_SEO_REFRESH | 保留原行为 | 1 |
| ORIVANE_SEO_API_BASE / ORIVANE_SITE_URL | 保留原行为 | 专用 Preview 域名 |
| NEXT_PUBLIC_SITE_URL | 未修改生产构建 | 专用 Preview 域名 |
| NEXT_PUBLIC_API_BASE_URL | 未修改生产构建 | 构建时显式置空，API 使用 Preview 同源 |
| NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN | 未修改生产构建 | 构建时显式置空，关闭分析上报 |

Preview 没有复用任何生产 OAuth、Resend、Gemini 或 optimizer secret。没有 Cloudflare 原生邮件 binding；现有应用通过 Resend HTTP API 发信。尚未提供独立测试发件配置，因此没有真实邮件投递测试。

## 自动任务隔离

- 没有创建或部署 Preview optimizer Worker，也没有给 Preview 添加 cron；线上 Worker 清单中未发现 Orivane Preview 自动任务 Worker。
- Production optimizer 保持原 KV、站点和 schedule，没有调用它的 run 接口。
- Preview 的 `/alerts/process`、`/kronos/batch`、`/forecast/settle` 对无有效机器凭据请求返回 403。
- Preview 构建明确设置 `ORIVANE_SKIP_SEO_REFRESH=1`，没有调用生产 SEO 刷新 API；`preview:cloudflare` 本地命令也已强制跳过刷新并选择 Preview 环境。
- 普通用户手工 `forecast/run` 已实测成功，其写入绑定是独立的 Preview forecast/cache/metrics KV。
- Preview 没有邮件 secret，提醒测试返回 `503 email_unavailable`，没有外发邮件。

## Smoke test 结果与边界

| 检查 | 结果 |
| --- | --- |
| 无 session | `/auth/me` 返回空用户；用户状态、删除账号、提醒、forecast run 返回 401；管理员接口返回 403 |
| 伪造 Bearer JWT / Cloudflare Access 头 | 不能成为普通用户，所有相关私有接口拒绝 |
| 原结构有效 session | A/B/测试管理员均通过 `/auth/me` 验证；未改 UUID、session 字段或用户数据路径 |
| 过期、ID 不一致、email 不一致、账号缺失 | 独立 Preview KV 测试夹具均被拒绝；续跑时先前真实过期的测试 session 也返回未登录 |
| `/user/state` GET / PUT / PATCH | 正常读写原 `users/${user.id}.json` 路径 |
| 双用户并发 | A/B 并发写入、12 个交错身份读取未串号；分别核对 Preview KV 内容 |
| 旧 A 请求携带 B Cookie | PATCH、删除、退出的预期账号护栏均返回 403；B 未受影响 |
| 浏览器 A 离线修改 → 退出 → B session | A 新增 NVDA 留在 A 的 IndexedDB 队列；B 页面、本地收藏、云端只有 QQQ，无 A 研究记录，未上传 A 队列 |
| 队列归属 | A 队列 1 条、B 队列 0 条，条目 owner 与数据库 namespace 一致；恢复 A 的有效 session 后，只更新 A，B 仍为 QQQ |
| 多标签页 | 两个标签页均随已验证身份切换至 B，再切回 A，没有保留旧账号界面 |
| 前端 Bearer | 观察到的普通 API 请求不含 Authorization；私有同步使用 Cookie 与账号匹配护栏 |
| 管理员 API | 测试管理员 200，普通测试用户 403 |
| 管理员页面 | **未通过**：API 200，但 `/monitor/` 对测试管理员显示“仅管理员可见” |
| forecast run | 有效 session 请求 SPY 返回 200，完成 Preview 内的真实预测生成与存储 |
| 退出、删除测试账号 | 正常失效/删除，其他测试用户仍可访问 |
| 邮件 | 安全关闭行为通过；真实发信未测试 |
| 邮箱注册、密码登录 | **未通过**：均被托管 Worker 的 PBKDF2 迭代上限阻断 |

由于密码登录受阻，浏览器的 B 身份建立使用了仅写入 Preview KV 的原结构测试 session，并由应用 `/auth/me` 正常验证。没有添加测试登录接口、身份回退或认证旁路代码。该验证覆盖账号切换与数据隔离，**不能替代完整的 A 退出 → B 密码登录成功验收**。

测试研究记录最初缺少 `reason` 字段，导致页面报错；已修正本轮测试数据并清理其浏览器缓存后复测。没有为测试改动业务代码。

## 两项待处理问题

1. **托管 Worker 密码派生兼容性**：`netlify/functions/api.mts` 当前 `PASSWORD_ITERATIONS = 210000`，注册和密码登录实测返回 `500 internal_error`，错误为 `Pbkdf2 failed: iteration counts above 100000 are not supported (requested 210000).` 该常量在第一阶段前已存在。Cloudflare 的 [workerd 限制实现](https://github.com/cloudflare/workerd/blob/main/src/workerd/io/limit-enforcer.h) 定义了该默认上限。需单独确定兼容修复并保留既有密码记录的验证能力，然后重跑注册、密码登录和完整浏览器登录流程。
2. **前后端管理员名单不一致**：Worker 接受 Preview 的 `ORIVANE_ADMIN_EMAILS`，但 `lib/admin.ts` 的静态名单不读取该配置，`components/monitor-page.tsx` 因而在前端拦住测试管理员。需单独修复名单/权限展示的一致性。

Apple JWT、Google email_verified、邮箱验证、OAuth state、CSRF、Access 和 KV 一致性仍按既定第二阶段范围处理。本轮没有因此继续修改认证实现。

## 本轮文件变更

- `wrangler.toml`：增加 Preview 专用变量及六项 KV 覆盖，生产顶层绑定不变。
- `package.json`：仅追加修改 `preview:cloudflare`，强制跳过 SEO 刷新并选择 Preview 环境。
- `docs/preview-environment-report.md`：本报告。

构建通过：113 个静态页面、TypeScript 检查和上传时 Worker 编译成功。`git diff --check` 通过。第一阶段认证代码、业务实现和锁文件没有在本轮继续修改。

详细的脱敏部署元数据、API 结果和浏览器观察记录保存在本地忽略目录 `.qa/preview-isolation/`。其中凭据夹具文件仅供本地测试，未加入版本控制或本报告。

收尾时已撤销 A/B/测试管理员的测试 session，并清理旧测试 session；测试账号与业务夹具只保留在 Preview KV。再次确认生产配置和生产部署 ID 未变。
