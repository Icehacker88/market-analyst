# Market Analysis / Orivane

更新日期：2026-09-30（Asia/Shanghai）。

本文根据当前工作区源码、配置及验收记录整理。**代码中已实现、Preview 已验收和 Production 已发布是不同状态**。9 月 30 日重新核对远端部署、实际绑定及凭据声明，重跑本地测试、类型检查和 Cloudflare 构建，并执行 Preview 未登录/伪造身份只读检查。用户随后提供当前 Workers Free 截图，结合官方文档确认适用 10 ms CPU/request 限额；现有证据不支持安全密码参数稳定运行，密码接入及部署继续停止；本轮没有修改应用代码、执行自动任务或部署。

## 1. 项目定位

Market Analysis 包含两条互补链路：

- **Orivane Web 投资研究工作台**：发现资产、查看行情与预测、理解风险、比较资产、收藏关注、管理组合并持续复盘。
- **Python 分析与投资日报**：获取历史数据、训练和评估模型、冻结预测、验证真实结果、生成报告，并通过 GitHub Actions 和邮件交付。

产品研究路径为：**发现资产 → 理解机会 → 查看风险 → 进入研究 → 收藏/关注 → 后续跟踪**。研究预测不等同于交易指令；项目未实现券商交易或自动下单。

入口：

- [Production](https://orivane-market-intelligence.pages.dev/)
- [Preview](https://codex-auth-phase1-preview.orivane-market-intelligence.pages.dev/)

9 月 30 日已核对 Preview 部署元数据及有限只读接口，不代表完整密码流程验收通过；Production 未进行业务验收。工具仅用于研究与参考，不构成投资建议。

## 2. 当前 Web 功能

| 页面 / 模块 | 当前代码功能 | 使用边界 |
| --- | --- | --- |
| 首页 `/` | 资产搜索、统一资产发现、继续研究、研究复盘、预测验证摘要 | 个人研究模块有对应数据才显示 |
| 分析 `/analysis/` | 最多同时比较 5 个资产；价格与首日归一化走势；区间收益、技术指标、预测和研究详情 | URL 保存资产选择；不同数据源和日期需分别理解 |
| 资产页 `/stocks/[slug]/` | 单资产研究入口，展示走势、预测、风险及验证证据 | 静态资产页由构建时目录生成；不保证任意代码都有独立静态页 |
| 资产与市场目录 `/stocks/`、`/markets/[slug]/` | 资产目录、市场主题和研究链接 | 与动态搜索的覆盖范围不完全相同 |
| 选股器 `/screener/` | 搜索、市场与行业等条件筛选、指标排序、保存筛选条件 | 面向当前覆盖资产，不承诺全市场完整扫描 |
| 研究候选 `/recommendations/` | A 股、美股、港股分组；研究理由、风险、周期及标签 | 是研究候选，不是收益承诺 |
| 收藏 `/favorites/` | 收藏、自选列表、关注资产变化和研究跟踪 | 登录后同步用户状态；本地私有数据按用户隔离 |
| 组合 `/portfolio/` | 手工维护持仓数量与成本；盈亏、权重、多周期预测、相关性、波动和回撤；压力情景与再平衡参考 | 历史风险包含固定权重模拟，不是券商真实成交收益 |
| 预测成绩 `/track-record/` | 回测与真实冻结预测分开披露；多周期验证、样本量、方向基准、误差、模型治理；记录筛选和 CSV 导出 | 未到期或未验证的预测不能计入已完成成绩 |
| 管理监控 `/monitor/` | API 请求、错误、延迟、缓存、产品事件、Web Vitals 与 optimizer 状态 | 有效 session 和服务端管理员名单共同授权 |
| 方法与说明 | `/methodology/`、`/risk-disclosure/`、`/privacy/`、`/terms/` | 说明方法、数据与使用边界 |

### 首页与搜索

- 搜索覆盖 Yahoo Finance 资产及东方财富 A 股、公募基金；支持代码、名称与本地名称匹配。实际可用性取决于上游响应。
- 本地结果优先，网络补充采用防抖；精确本地匹配避免多余请求。
- 资产发现有五种视角：近一年表现较强、今日强势、1M 预测偏强、1M 预测偏弱、高波动观察。
- 明确区分加载中、无数据、请求失败、缓存过期；刷新失败可保留旧值并提示。
- 缺少 1M 数据不以其他周期替代；20 日波动率不是完整风险评级。
- 复用 `/api/home` 和预测成绩接口，不为首页每个候选单独请求预测。

### 预测、研究与 AI

- Web 数据结构支持 1D、5D、10D、1M 预测，以及情景区间、关键价位、失效条件、信心和市场状态；具体字段以资产可用数据为准。
- 公司研究包括市场信息、基本面、新闻及财报日期等；上游缺失字段允许为空。
- 详情页展示模型组成、历史预测演变、预测与实际对照，以及回测和真实账本证据。
- Gemini 支持资产研究问答和组合研究问答；组合摘要在用户提交问题后发送。
- AI 接口包含配额控制、错误处理及结构化降级；流式展示不代表模型提供商一定采用原生流式生成。
- 未配置 AI 凭据时不应把结构化降级内容当作 Gemini 成功生成。Preview 历史配置未启用外部 AI 生成。

### 私人研究与提醒

- 用户状态包括自选列表、提醒及提醒历史、组合、保存的筛选器、研究偏好、持仓/观察决策资料、复盘计划、资产及组合 AI 对话。
- 提醒支持价格上穿/下穿、涨跌幅、信号、信心及失效条件；通知偏好包括邮件、浏览器、摘要、安静时段与最小间隔。
- 邮件测试和自动提醒代码已存在，但真实投递依赖环境凭据及任务运行；Preview 未配置外发邮件，历史验收仅验证安全关闭行为。
- 提供中英文、明暗主题、响应式布局、PWA manifest、Service Worker 和离线提示。离线缓存不能代替实时行情或在线认证。

## 3. 系统结构与数据链路

```text
Market Analysis/
├── Market Analysis.md                  当前功能与状态总览
├── .github/workflows/                  日报与官方 Kronos 批处理
└── 股票预测/
    ├── main.py                         Python 命令行入口
    ├── src/                            数据、特征、模型、账本、日报和邮件
    ├── backend/app/                    本地 FastAPI 行情与 Python 预测适配层
    ├── scripts/                        公共数据导出、官方 Kronos 批处理
    ├── data/history/                   Python 真实预测账本
    ├── outputs/                        分析结果和日报输出
    └── frontend/
        ├── app/、components/、lib/     Next.js 页面、组件、状态与 API 客户端
        ├── netlify/functions/api.mts   云端 API 维护源
        ├── scripts/                   Cloudflare Worker 与 SEO 数据生成器
        ├── functions/api/[[path]].ts   生成后的 Pages Worker API
        ├── workers/favorite-optimizer.ts
        ├── tests/                     Cloudflare 安全与运行时测试
        └── docs/                      分阶段安全与 Preview 验收报告
```

前端使用 Next.js 16、React 19、TypeScript、ECharts，采用静态导出；云端 `/api/*` 由 Cloudflare Pages Functions/Worker 执行。`netlify/` 是维护源路径的一部分，不能据此认定线上运行于 Netlify。

**云端 Worker 与本地 FastAPI 并非相同实现**：

| 链路 | 计算与存储 | 预测触发方式 |
| --- | --- | --- |
| Python / FastAPI | Python 模型、文件缓存、`outputs/`、CSV 预测账本 | 提交后台分析任务并查询状态 |
| Cloudflare Worker | 云端行情、TypeScript 预测组合、公共数据包与 KV 预测账本 | `/api/forecast/run` 同步生成；状态查询接口不提供后台任务 |
| 官方 Kronos 批处理 | GitHub Actions 中运行官方模型，上传预测供云端读取 | 定时或手动工作流；受机器身份验证保护 |

云端组合含动量、趋势、均值回归、突破、市场状态、K 线结构、历史相似状态等；有合格数据时可叠加官方 Kronos 和基本面/事件信息。**本地 K 线结构模型与官方 Kronos 是不同来源**，不应混称。Python 默认模型包含基准、线性回归、随机森林、方向分类模型及 ARIMA；可选增强模型依赖额外安装。

## 4. API 与身份边界

下表为云端 API 主要入口，不代表本地 FastAPI 全部支持。

| 类别 | 主要路径（均以 `/api` 开头） | 边界 |
| --- | --- | --- |
| 公共数据 | `/health`、`/assets/search`、`/assets/resolve`、`/home`、`/market/*`、`/compare` | 行情、发现、搜索与比较 |
| 研究与预测 | `/company/research`、`/screener`、`/recommendations`、`/forecast/latest`、`/forecast/scoreboard`、`/performance/{symbol}`、`/predictions/history/{symbol}` | 读取研究和验证数据 |
| 应用账号 | `/auth/config`、`/auth/me`、`/auth/signup`、`/auth/login`、`/auth/logout`、`/auth/account` | 注册、登录、会话查询、退出、删除；密码链路仍有阻塞 |
| 用户私有状态 | `/user/state` | 有效应用 session；GET / PUT / PATCH |
| 提醒测试 | `/alerts/test` | 有效应用 session；真实发信还需邮件配置 |
| 手动重新预测 | `/forecast/run` | 普通用户须有效 session；另保留专用机器任务授权 |
| 管理员 | `/admin/metrics` | 独立服务端管理员授权 |
| AI | `/ai/analysis`、`/ai/analysis/stream` | 受配置、配额和请求校验约束 |
| 自动任务 | `/alerts/process`、`/kronos/batch`、`/forecast/settle` | 专用任务凭据或相应受验证机器身份；不是普通用户登录入口 |

### 第一阶段认证现状（当前工作区）

- 普通用户身份只从应用验证后的 `orivane_session` Cookie 获得；Cookie 为 HttpOnly、Secure、SameSite=Lax，session 有效期为 30 天。
- 校验 token、有效期、账号存在、`session.user_id === account.id` 及 session/account email 一致；查询失败或无效时按未登录处理。
- 删除普通用户的未验证 Bearer JWT / `getUser()` 兼容回退，以及 `ACTIVE_REQUEST`、`ACTIVE_ENV` 请求全局状态；依赖在请求范围内创建并传递。
- 前端普通用户 API 使用 `credentials: "include"`，不再从 `orivane-auth-token` 读取或发送身份凭据。
- 浏览器私有 localStorage、IndexedDB 和离线补丁队列按用户隔离；账号切换取消旧请求并阻止旧用户状态写入新账号。旧队列留在原用户范围，不意味着退出会擦除全部离线数据。
- 管理员由有效 session 和服务端 `ORIVANE_ADMIN_EMAILS` 计算，`/auth/me` 返回 `is_admin`；UI 只接受严格的布尔值 `true`。服务端仍独立授权，变量缺失或为空时拒绝管理员权限。
- 退出、账号切换、会话失效或管理员接口 403 会触发身份重验或权限清理，监控数据随身份边界清理。
- 机器任务仍可使用专用 Bearer 凭据；这不构成普通用户 Bearer 登录，也不能据此删除自动任务授权。

身份与数据路径保持不变：

| 记录 | 路径 / 标识 |
| --- | --- |
| 账号查找 | `auth/users/${encodeURIComponent(email)}.json` |
| Session | `auth/sessions/${token}.json`，关联 `user_id`、`email`、`expires_at` |
| 用户私有状态 | `users/${user.id}.json`，稳定用户 UUID 为归属依据 |
| 浏览器私有数据 | 按 `userId` namespace 隔离，访客有独立范围 |

email 用于账号查找与一致性校验，不能单独替代经过验证的用户 UUID。Session 继续使用 KV；没有迁移 Durable Objects，也不承诺 KV 撤销具有全球即时一致性。Cloudflare Access 仅属于后续 admin/staging 内部保护规划，不是普通用户身份来源。

## 5. 自动化、日报与数据存储

### 日报与模型任务

- Python CLI 支持本地 CSV、Yahoo Finance，以及可选 AKShare A 股/基金数据；按时间顺序训练和验证，生成预测、模型比较、图表和中文摘要。
- 日报产出包括 `summary.md/html`、市场快照、新闻、模型预测、真实账本快照、滚动表现、最新验证结果和 `email_status.txt`。
- `.github/workflows/daily-market-report.yml` 当前配置七个 UTC+8 触发点：07:17、07:47、08:17、08:47、09:17、10:17、12:17；使用 Asia/Kuala_Lumpur 日期去重，并检查新完成的美股交易时段。不是每个触发点都会发邮件。
- 日报工作流配置 `DISABLE_GPT_ANALYSIS=true`；网页 Gemini 与 Python 日报 OpenAI 解读是不同功能。
- `.github/workflows/kronos-daily.yml` 配置 UTC 周一至周五 22:30 运行，即 UTC+8 周二至周六 06:30；亦支持手动触发。上传使用 GitHub OIDC 授权。
- 收藏 optimizer 代码按关注/持仓资产及核心资产生成预测、结算账本、预热公共数据并处理提醒。**本次未触发上述任务，也未验证最近一次线上运行。**

### Cloudflare KV 与 Preview 隔离

| Binding | 用途 | Preview 边界 |
| --- | --- | --- |
| `ORIVANE_USER_STATE` | 账号、session、用户私有状态 | 独立 namespace，禁止写 Production 用户状态 |
| `ORIVANE_API_CACHE` | API 数据缓存 | 独立 namespace |
| `ORIVANE_API_METRICS` | 请求、缓存、任务等监控数据 | 独立 namespace |
| `ORIVANE_ASSET_LOGOS` | 资产图标缓存 | 独立 namespace |
| `ORIVANE_AI_USAGE` | AI 使用量 | 独立 namespace |
| `ORIVANE_CLOUD_FORECASTS` | 云端预测及相关记录 | 独立 namespace |

9 月 30 日重新核对：本地 `wrangler.toml`、远端 Preview 配置及实际部署的六个 KV binding 一致，全部与 Production 隔离。Preview 配置包含测试管理员，未声明生产 OAuth、AI、邮件或 optimizer 凭据；账户 Worker 清单未见 Preview 自动任务 Worker，本轮没有触发任何自动任务，构建跳过 SEO refresh。未复核外部调度平台的全部任务。邮件使用 Resend HTTP API，当前绑定中没有 Cloudflare 原生邮件 binding。

## 6. 当前交付状态与阻塞

| 事项 | 状态及证据日期 |
| --- | --- |
| 第一阶段 session 与跨账号隔离 | 当前工作区已实现；9 月 6 日 Preview 已验证 session 读写、隔离、伪造身份拒绝等，详见专项报告 |
| 管理员前后端一致性 | 版本隔离复核确认当前 Preview 已含管理员标记与清理代码；9 月 30 日本地 7 项管理员测试通过、Preview 匿名/伪造身份 API 均为 403；真实密码登录后的 `/monitor` 验收仍未完成 |
| 首页第一轮优化 | 9 月 10 日交付记录确认 Preview 部署及桌面、平板、手机验收；Production 未随该轮发布 |
| 新密码 scheme 与严格历史 verifier | **尚未接入**；托管 benchmark、完整注册/密码登录验收未完成 |
| Production 发布 | 本轮没有发布授权；本次未部署或修改远端配置 |

### 密码系统仍是主要阻塞

当前源码仍使用 WebCrypto PBKDF2-SHA256、210000 iterations 写入密码，并保留旧 salted SHA-256 验证。9 月 Preview 实测遇到托管 Worker 原生 PBKDF2 迭代限制，注册及密码登录未通过；不能把 session 夹具测试等同于真实密码登录成功。

9 月 8 日生产记录结构调查未发现 PBKDF2 记录；历史记录主要为 salted SHA-256 格式，另有无密码的 provider 账号。此为历史结构结论，不包含真实 hash、salt、用户信息，也不表示已完成新 verifier。

已批准但尚未实现的方案要求：

- 优先成熟 Argon2id，起点 `m=19456 KiB, t=2, p=1`；不可行时使用固定版本 noble PBKDF2-SHA256 600000。
- 新记录必须显式声明 scheme/version/参数；210000 仅保留为历史兼容 verifier，不作为目标新格式。
- 旧 salted SHA-256 与历史 PBKDF2 必须严格验证；只有正确密码登录成功后才可升级，不批量重写、不降低参数、不把不同迭代数混用。
- 无法识别、损坏、验证失败或缺少密码 hash 均须拒绝，不允许宽松回退。

9 月 8 日实际 Miniflare/workerd 本地 benchmark：Argon2id 约 **22 ms CPU/次**，noble PBKDF2-600000 约 **533 ms CPU/次**。当日控制台确认为 Workers Free、10 ms/request，因此按用户要求停止接入；这些仅为历史本地结果，不是本次测量，也不是 Cloudflare 托管 CPU，**尚无托管 Preview benchmark**。9 月 30 日用户提供本账户 Workers plans 截图，Free 明确标为 Current plan；结合本次重新读取的[官方限额文档](https://developers.cloudflare.com/workers/platform/limits/)，适用 10 ms CPU/request。该套餐结论来自本次截图；历史本地耗时仍不等于托管测量。按用户停止条件，密码接入和部署停止，不升级套餐、不降低参数。可保持暂停，或由用户日后决定升级后重新 benchmark；其他认证运行环境需另立范围评估。

另外，9 月 30 日重新核对 Production 仍未显式配置 `ORIVANE_ADMIN_EMAILS`；本轮未修改。未来发布前必须重新确认，否则新代码会按设计拒绝管理员。

### 第二阶段保留项

Apple ID token 验签、Google `email_verified`、邮箱所有权验证、OAuth state/nonce/PKCE、CSRF、Cloudflare Access 内部页面保护、KV 一致性/撤销，以及账号删除分页与失败处理仍需单独加固。Apple 登录据用户确认未面向生产用户启用，不应在完成加固前开放。第一阶段完成不等于上述问题已解决。

## 7. 开发、验证与后续验收

常用入口（均在 `股票预测/frontend/` 执行）：

```bash
npm run dev
npm test
npm run test:security
npm run typecheck
ORIVANE_SKIP_SEO_REFRESH=1 npm run build:cloudflare
npm run preview:cloudflare
```

`preview:cloudflare` 启动本地 Wrangler Preview，不是远端部署。完整应用 session/KV 验证应走 Worker 路径；本地 FastAPI 主要服务行情和 Python 模型，不能代替 Worker 认证测试。Cloudflare 构建必须通过维护源与生成器生成 Worker，不单独手工修改生成文件。Preview 构建还需核对站点地址、API 同源设置及完整环境覆盖。

既有验证记录：

- 9 月 8 日认证/管理员修复：33 个测试文件、142 项通过，类型检查与 Cloudflare 构建通过。
- 9 月 10 日首页交付：34 个测试文件、150 项通过，类型检查、Cloudflare 构建和响应式检查通过。
- 9 月 30 日本次重跑：安全专项 5 文件 / 63 项、完整前端 34 文件 / 150 项通过；类型检查和 Cloudflare 构建通过。安全专项包含生成后的 Worker 在本地 Miniflare/workerd 的验证；不等于托管密码验收。
- 9 月 30 日 Preview 只读检查：未登录及伪造 Bearer JWT 均得到空用户、私有状态 401、管理员接口 403；Google/Apple 均关闭。未注册账号、未直接写入 KV session、未做真实邮件投递或 A/B 密码流程。

密码阻塞解决后仍须完成：托管候选 benchmark → 接入明确版本格式与严格 legacy verifier → 注册/旧密码升级/210000 兼容/损坏及空记录测试 → Preview 注册 → 退出 → 密码登录 → A/B 真实登录切换 → `/monitor` 验收。Production 发布继续需要单独授权。

## 8. 相关文档

- [Python 工具与本地使用说明](股票预测/README.md)：保留详细 CLI 示例；其中旧首页、自动运行时间及收藏描述以本文和当前源码为准。
- [第一阶段安全修复报告](股票预测/frontend/docs/security-phase-1-report.md)
- [Preview 环境与第一轮验收](股票预测/frontend/docs/preview-environment-report.md)：9 月 6 日历史快照。
- [密码与管理员调查](股票预测/frontend/docs/preview-blockers-investigation-2026-09-08.md)：早期方案中的新密码参数选择已被后续要求取代。
- [密码与管理员最新专项状态](股票预测/frontend/docs/preview-password-admin-status-2026-09-30.md)：本次环境复核、测试及配额阻塞。
- [9 月 8 日密码与管理员状态](股票预测/frontend/docs/preview-password-admin-status-2026-09-08.md)：历史 benchmark 与本地修改记录。
- [第二阶段安全待办](股票预测/frontend/docs/security-phase-2.md)

## 9. 后续开发与版本隔离

认证与密码工作流已冻结。后续 UI/产品开发使用独立工作区和 `codex/ui-preview-ff7fd40d` 分支；原始 `main` 工作区保留全部既有修改，不作为新 Preview 部署来源。具体源码 checkpoint、当前 Preview 已包含内容和未部署研究材料边界见 [版本隔离记录](股票预测/frontend/docs/version-isolation-2026-09-30.md)。本次只整理本地版本状态，不部署。
