# My Research Reliability + Action Queue — Round 1

日期：2026-10-04，Asia/Shanghai。仅本地实现和验证；未部署 Preview 或 Production。

开发目录：`/Users/icehacker/.codex/worktrees/orivane-ui/Market Analysis`。
分支：`codex/ui-preview-ff7fd40d`。本轮基线：`8cb188e`（已接受的首页 Round 2.1）。本轮一个提交；等待单独 Preview 授权。

## 范围与行为

- `/favorites/` 依次展示“今天需要处理 → 我的关注 → 最近查看”。列表管理、提醒和通知设置保留在辅助折叠区，既有提醒 deep link 会展开设置。
- 关注成员取自完整 `userState.watchlists`，不依赖资产身份查询返回数量。资产身份暂缺也保留该行及 ticker。
- 通用 `/assets/resolve` 先规范化去重，再返回全部解析结果；删除了错误复用的比较数量上限。`/compare` 的 5 只上限保留。Worker 经原维护源及原生成器生成。
- 仅我的研究使用新的可观测批量取数：每批 4 只、最多 2 批并发，逐批展示。既有 snapshot API 的 20 只上限和内部每 4 只批处理未改动；不会为每资产发 forecast HTTP。
- total=完整已载入关注成员；resolved=已有有效身份（包含已有 favorites/本地目录身份）；checked=完整、客户端缓存新鲜的行情和预测；failed=本轮获取/逐资产数据错误；unchecked=尚未完成取数（包含 loading）；stale 单列。checked + failed + unchecked + stale = total，resolved 为独立维度。
- 保留逐资产 errors；部分可用数据仍展示，但不据此确认完整变化。缺数据不替代为 0 或其他周期。全部失败明确显示失败，不显示暂无变化。
- 本地缓存 fresh 15 分钟，stale 最长 24 小时；stale 会后台刷新并更新当前页面，错误保留可用旧值及失败状态。新鲜缓存到期、回到标签页或重新联网可触发重新检查；手动刷新绕过本地新鲜缓存。
- 同一资产的到期计划、实质预测反转（Up↔Down）、用户价格/日涨跌阈值命中、相关已记录提醒合并为一个主事项；逾期计划先展示。仅日期、模型刷新、普通价格变化、默认 3 分可信度变化不制造事项。已有用户可信度提醒的历史触发记录仍可入队。
- 历史提醒显示发生时间；`read_at` 不表示已复核。相同规则重复历史只保留最新一条。计划字段显示参考价、预定日期、原关键位和原因。突破/回踩/失效位计划按日期提示，不伪称价格条件已触发。
- 不显示“完成复核”或虚假的完成进度；不增加 thesis、研究记录、完成历史或后台事件 schema。
- 本机独立比较基准使用已有 forecast snapshot 值结构和现有用户隔离 privateStorage，新 key 为 `orivane-my-research-baseline-v1`。只为缺少基准的资产以完整新鲜响应初始化；后续检查、查看、刷新、提醒已读均不推进基准。首次观察与已有基准无变化分开显示。
- 已成功缓存的反转在刷新失败时仍保留为“上次数据方向变化（待更新确认）”；不把失败当成事件已完成，不以旧行情新确认价格条件。
- 只有现有普通规则和计划，缺少明确高优先级及用户原判断方向字段，因此不推断 P0。本轮事项为 P1；新 schema 授权前不将模型失效位包装成用户判断失效。
- 保留现有 private state/offline queue/账号隔离实现。未依据登录或 `cloudSyncing=false` 宣称“已同步”；登录时同步终态仍标未确认，游客标本机保存。无云端成功确认时，空列表只表示本机当前没有可显示成员。

## 文件

运行时代码：
- `components/favorites-page.tsx`：接入工作区，辅助设置折叠及 deep link；移除该页面的旧清单/极值卡取数。
- `components/my-research-workspace.tsx`、`components/my-research.module.css`：覆盖状态、统一队列、全部关注、最近查看及局部响应式样式。
- `components/use-my-research.ts`、`lib/my-research-data.ts`：缓存可观测、渐进批量加载、请求去重及生命周期保护。
- `lib/my-research.ts`：队列、严格覆盖统计、保守基准规则。
- `lib/api.ts`：仅新增 opt-in snapshot transport；原调用、认证和缓存逻辑未改。
- `netlify/functions/api.mts`：仅通用 resolve 路由去重及移除比较上限；其他路由不变。

测试：`components/my-research-workspace.test.tsx`、`components/use-my-research.test.tsx`、`components/research-coverage.test.tsx`、`lib/my-research.test.ts`、`lib/my-research-data.test.ts`、`tests/cloudflare-watchlist.test.ts`。

## 本次验证

- 完整前端测试：43 文件 / 233 项通过（包含既有认证、隔离、首页和 Service Worker 回归测试）。
- typecheck 通过。
- `ORIVANE_SKIP_SEO_REFRESH=1 npm run build:cloudflare` 通过；未使用任何部署命令。
- 实际生成的 Worker 在本地 Miniflare/workerd 中验证 resolve 5/20/50 完整返回、请求规范化去重、compare 仍限 5。外部行情请求使用隔离测试响应，不是托管 API 验收。
- Provider 集成测试：两个交叠云端列表恢复 5/20/50 个唯一成员，1 次 user state GET + 1 次 resolve；真实 Provider 配合模拟 API，不能替代上述实际 Worker 合约测试。
- 数据及 UI 测试覆盖全部/部分失败、stale 后台成功更新、慢批次逐步显示、缺失/损坏数据拒绝比较、无基准、日期更新不入队、多原因归并、已读不等于已完成、刷新/重新挂载不改基准、空状态。

### 本地浏览器实测

生产构建静态输出在 `127.0.0.1:4181` 验证，使用隔离浏览器上下文、合成游客数据和拦截 API 响应。未使用真实账户、云端 KV 或生产凭据。

| 关注数量 | 可见关注行 | snapshot HTTP | 逐资产 forecast HTTP | 工作区额外 resolve HTTP | 最大 snapshot 并发 |
|---:|---:|---:|---:|---:|---:|
| 5 | 5 | 2 | 0 | 0 | 2 |
| 20 | 20 | 5 | 0 | 0 | 2 |
| 50 | 50 | 13 | 0 | 0 | 2 |

这些是浏览器实际发出的研究数据请求计数，响应为受控测试数据；不包含账号配置、健康检查、analytics、logo 和静态资源。另在真实浏览器中模拟已登录身份和云端 API 返回，5/20/50 均实际记录到 Provider 的 1 次 user state + 1 次 resolve，仍展示全部成员；研究相关请求合计分别为 4/7/15 次。未重复读 user state。这是受控云端恢复流程，未验证真实密码登录或托管云端状态。

- 人为延迟首批时，5 只先显示 1/5，20/50 只先显示 4/20、4/50；没有等最慢批次才一次展示全部。
- 全失败：20 行仍保留，0/20 已检查、20 失败，不显示暂无变化。
- 部分失败：18/20 已检查、2 失败，保留部分行情。
- 仅日期变化：20/20 已检查、0 主事项。
- 刷新再 reload：同资产仍只有 1 个主事项，原 Up 基准未变；20 只首次 5 请求、强制刷新 5 请求，reload 使用新鲜缓存。
- 新用户：0 个数据批次，有查找资产入口，无虚假进度。
- 1440×1000、768×1024、390×844 的 document scrollWidth 均等于 viewport width；已目视检查截图。
- 正常取数场景无应用 console error/pageerror。每个隔离上下文有 Playwright 禁用 Service Worker 的预期工具 warning；本轮没有重复进行托管 SW 验收。失败场景的受控 503 为预期。

浏览器脚本、结果与截图在忽略目录 `output/playwright/my-research/`；不是发布内容。模拟云端恢复截图为 `cloud-favorites-1440.png`、`cloud-favorites-768.png`、`cloud-favorites-390.png`；游客与失败截图：`favorites-1440.png`、`favorites-768.png`、`favorites-390.png`、`all-failed.png`、`partial-failed.png`、`date-only.png`、`reload.png`、`empty.png`。

## 未解决边界

- fresh/stale 表示客户端响应缓存年龄，不是交易所实时性。服务端既有 `cachedValue` 可能在上游失败后返回旧数据且没有统一 freshness 标志；本轮未重构该机制。每行显示行情/预测的 data_as_of，不能把 HTTP 200 当作行情最新的保证。后续若要求端到端来源新鲜度，需要单独的 API 元数据范围。
- 服务端一个批次内仍等最慢项；本轮将影响限制为每批 4 只，另一个批次可以继续。没有重构后端调度/预测生成；读取无冻结预测时，既有 snapshot 服务仍可能生成预测。
- Provider 恢复身份后，snapshot 服务端仍会解析资产；云端保存后的 Provider 也可能重复解析列表。本轮消除了工作区额外 resolve，不改共享 Provider/认证代码。
- 基准仅本机、没有确认/完成事件或跨设备历史；实际值恢复到原基准可能使变化消失，这是当前状态比较，不是完成确认。用户删除规则后相关历史不再作为当前事项；本轮不建立永久事件档案。
- 保存的价格复核计划没有原方向及明确触发语义，仍按预定日期显示；自动条件判断仅针对已有明确 above/below/change 规则。
- 50 行仍全部渲染，无列表窗口化；没有性能数字支持 LCP/INP 改善声明。
- Preview 自动提醒、邮件、真实云端同步及托管延迟未在本轮验收；需要单独部署授权后验证。

## 隔离与下一步

首页组件、首页 CSS/全局 CSS、portfolio、AI chat、auth/provider/session/admin、Worker 生成器、依赖及 Cloudflare 配置没有本轮变更。共享 resolve 的完整返回会纠正其他现有消费者的身份恢复数量，但没有修改冻结首页的视觉、架构或变化逻辑。

一个本地提交后停止，等 Preview 授权。回退为该提交的独立 revert 或重新构建原 `8cb188e`；这不构成部署授权。Production 未部署、未改配置，未运行 optimizer。
