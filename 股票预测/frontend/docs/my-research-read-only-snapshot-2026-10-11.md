# My Research — Strict Read-only Snapshot（本地完成，未部署）

日期：2026-10-11，Asia/Kuala_Lumpur。
Worktree：`/Users/icehacker/.codex/worktrees/orivane-ui/Market Analysis`。
分支：`codex/ui-preview-ff7fd40d`；本轮起点：`f49dddb`。

本轮仅采用方案 A；没有部署 Preview/Production、修改套餐或触发 optimizer。托管环境仍需单独授权验收，本文的成功数和耗时不是托管结果。

## API 与实际执行路径

My Research 使用 `GET /api/market/snapshot?mode=read-only&symbols=NVDA,SPY&v=2`。该模式固定返回轻量行情与预测字段，不使用 `start/view/include`。服务端允许 1–4 个规范 ticker（去重后），客户端固定每批 2 个、最多 2 批并发；数量超限、格式错误、未知 mode 返回 422。未传 mode 的默认接口维持原来的参数、20 只上限、缓存和计算语义。

实际路径：

```text
/favorites/ → useMyResearch → researchDataLoader
→ getResearchSnapshotBatch（no-store；每批2只、并发2）
→ 生成的 Pages onRequest（绕过 Edge 缓存）
→ route 的显式 read-only 分支
→ readOnlyMarketSnapshot（每只独立隔离行情/预测读取错误）
   ├─ 本地 catalog / inferAsset（无网络身份解析）
   ├─ ORIVANE_API_CACHE.get(history-v5/recent-年份/…)
   └─ readStoredForecast → ORIVANE_CLOUD_FORECASTS.get(forecasts/v11/…)
→ 校验原始日期/缓存年龄 → 轻量字段投影 → JSON 响应
```

完整、日期一致且未过期时保留现有纯 `applyCurrentForecastGuard` 规则，避免绕过既有 actionability 限制。它只校验已保存的验证摘要，不重新跑模型或回测；损坏的 guard 输入只使该资产预测失败，不拖垮另一只资产。

**不调用** `resolveAsset` 的上游搜索、`cachedPublicHistory/publicHistory`、`readFrozenCloudForecast` 的有副作用路径、`trendForecast`、walk-forward、forecast generation、账本读取/结算/写入、模型治理更新。纯 `readStoredForecast` 从旧读取器抽取，旧读取器仍保留原有行为与错误边界。

行情只读现有 recent 窗口的缓存；不扫描多年窗口、其他批次响应或静态备份。不在目录的通用 Yahoo ticker 最多探测 market / stock / etf 三种已有 key。预测只读规范 v11 冻结记录；不将其他来源不明的响应包装为新鲜预测。因此“只存在其他窗口/旧批次缓存”可能返回 unavailable，这比触发隐式计算或猜测日期更保守。

返回仍为 `{ data: MarketSnapshot[] }`；只读响应新增 `read_only` 元数据：

```json
{
  "version": 1,
  "queried_at": "服务端读取开始时间（ISO）",
  "query_status": "complete 或 failed",
  "history": {
    "source": "history_cache",
    "status": "available / stale / unavailable / failed",
    "data_as_of": "原始行情日期或 null",
    "stored_at": "原始写入时间或 null",
    "generated_at": null,
    "expires_at": "有效期限的 Unix 毫秒或 null",
    "reason": "缺失、过期或失败原因（必要时）"
  },
  "forecast": {
    "source": "frozen_forecast",
    "status": "available / stale / unavailable / failed",
    "data_as_of": "原预测数据日期或 null",
    "stored_at": null,
    "generated_at": "已有预测生成时间或 null",
    "expires_at": "有效期限的 Unix 毫秒或 null"
  }
}
```

`query_status=complete` 只说明读取完成，允许数据不存在；HTTP 200 也可包含逐资产失败。`errors[]` 保留 kind/message，并用 code 区分 unavailable 与 failed。行情返回已有 price / 1D return / 20D annualized volatility，`records=[]`；预测仅返回队列所需字段，不发回历史大数组。缺失数值为缺失/null，不替换成 0。

## 完整性、新鲜度与展示

| 客户端状态 | 含义 | 是否可新确认事项 |
|---|---|---|
| loading / unchecked | 正在查询 / 尚未查询 | 否 |
| fresh / 已检查 | 完整行情及预测、日期一致、源期限与本机期限均有效 | 可以比较，不代表上游实时 |
| partial / 部分可用 | 只有行情或只有预测 | 否 |
| unavailable / 无存储数据 | 读取成功，但两个数据源都不存在 | 否 |
| failed / 获取失败 | KV/校验/网络错误；有旧值则保留 | 否 |
| stale / 缓存待更新 | 有完整值但期限过期、时间不明或日期不一致 | 否；历史反转最多“待更新确认” |

- 顶部保留 total / resolved / checked / failed / unchecked / stale，增加 partial / unavailable 与独立 queried（只读查询完成）。`checked + partial + unavailable + failed + stale + unchecked = total`；loading 属于 unchecked。queried 包含读取成功但部分/无数据的资产，不代表可比较。resolved 仍表示有效资产身份，而不是行情覆盖。
- 部分可用数据中的过期来源在行状态中额外显示“含过期缓存”，来源折叠区逐项展示状态与时间。
- 缓存源期限：行情取原 expires_at 与 stored_at+30分钟中较早者；预测最多 generated_at+30小时。另设保守的原始数据日期上限：该 UTC 日期结束后 4 天。不是交易日历，也不能保证上游最后一个交易日已入库；长假可能保守显示过期。未知/未来生成时间不能当新鲜数据。
- 本机最多缓存新鲜响应 15 分钟，但不能延长服务端剩余期限；以请求开始时刻换算 TTL，扣除慢响应影响。页面开放期间到期会降级并重读。
- UI 分别显示行情/预测 data_as_of、原行情缓存时间、已有预测生成时间、本机接收时间；无“实时/最新已确认”承诺。
- 手动刷新重读存储，不能刷新上游或现场生成预测；存储未变则仍旧/缺失。后台读取成功更新当前页面；失败保留已知值和失败状态。手动刷新失败后，缓存复用及重新挂载不会恢复成 fresh，必须成功重读。
- 无完整有效数据时不初始化 baseline，也不新确认反转或价格阈值命中；到期计划与历史提醒不受影响。查看、刷新、提醒已读不推进既有基准，不宣称完成复核。

## 缓存与副作用

- 只读 URL 使用独立 mode/v2 key，不能消费默认 Snapshot 的 v1 客户端缓存；没有只读元数据的响应会被拒绝当作 fresh。
- 服务端不创建响应 KV key，不调用 `cachedValue`，响应 `private, no-store`，生成器显式绕过 Edge cache。只读请求也不写 API/cache metrics，包含错误分支；不安排 `waitUntil` 后台任务。
- **业务 KV 写入 0，响应 KV 写入 0，Edge 响应缓存写入 0。** 代价是未命中本机缓存或手动刷新时需要重读源 KV。
- 通常每资产 2 次 KV get，50 只为 100 次；未知类型最多 4 次/资产，50 只最坏约 200 次。客户端减少 HTTP 批次不减少这部分 KV 读取。未使用新命名空间，未增加存储 schema 或后台生产者。
- partial/unavailable/failed 响应只在浏览器短期复用 30 秒；状态原样保存，不能被缓存成完整成功。过期内容可保留展示，下一次读取触发时重新查询；手动刷新绕过短期复用。首次纯网络失败没有数据可缓存，不增加自动重试。
- 本机离线保存只含公共市场响应及接收/失败时间；原有账号私有 baseline / offline queue / user state 隔离未变。

## 本次测试与性能

- 完整测试：44 个文件、257 项通过，含旧首页、Service Worker、认证/账号隔离、全量 watchlist resolve、compare 5只限制、默认 Snapshot 回归。
- typecheck 与 `ORIVANE_SKIP_SEO_REFRESH=1 npm run build:cloudflare` 通过；Worker 通过维护源和生成器更新。
- 生成后的真实 Worker 在 Miniflare/workerd 中运行。测试仅在内存 bundle 中给 18 个禁止调用函数加 trap，代理六个本地 KV binding 记录读写，并等待所有后台任务；只读路径断言禁止函数调用 0、KV 写入 0、后台任务 0、上游 HTTP 0、Edge BYPASS。
- 覆盖 5/20/50 全量成功，20/50 的混合完整/partial/unavailable/stale/failed，以及全部源读取失败；还覆盖行情/预测各自缺失、两者缺失、过期/日期不一致/未知时间/损坏记录、损坏 guard 的逐资产隔离、默认接口历史记录不丢失。
- 客户端与 UI 测试覆盖渐进展示、并发限制、无逐资产 forecast HTTP、保留错误与旧值、短缓存/手动绕过、慢响应不延长 TTL、失败后重挂载、不完整数据不入新事项、覆盖率显示与新用户空态。

可重复基准：`node scripts/benchmark-read-only-snapshot.mjs <本地输出路径>`，仅启动本地 workerd 与本地临时 KV，不接收账户配置或连接托管服务。数值原始记录见 [benchmark JSON](benchmarks/my-research-read-only-2026-10-11.json)。

合成输入每资产 1,250 行、22 列历史，约 585,600 bytes；已有预测为轻量合成记录。以下为预热后 5 次运行的中位数，时间是 **本地请求墙钟时间，不是 Cloudflare CPU**：

| 关注数 | Snapshot HTTP | 最大并发 | 完整检查 | 首批返回 | 全部完成 |
|---|---:|---:|---:|---:|---:|
| 5 | 3 | 2 | 5/5 | 3.59 ms | 8.26 ms |
| 20 | 10 | 2 | 20/20 | 3.35 ms | 29.44 ms |
| 50 | 25 | 2 | 50/50 | 3.74 ms | 71.88 ms |

首次 5只运行首批 9.13 ms、全部 13.74 ms。50只轻量响应总量约 46.6 KB。每批仍需等待该批 2只完成，其他批次可先显示。

成功采集本地 V8 Inspector CPU sampling（100μs采样间隔）：另一次 50只、25请求、并发1的采样窗口中，非 idle 采样累计约 73.31 ms。大部分计入 `(program)`/运行时，包含 profiler 开销和本地运行时/原生工作，**不能除以请求数后当作每请求计费 CPU，更不能证明 Free 10ms 达标**。未取得托管 billed CPU、CPU p95 或真实冷启动分布。

## 修改文件与兼容性

- `netlify/functions/api.mts`：纯冻结读函数、只读分支、来源/期限校验、错误隔离；只读 metrics 写入排除。已有 forecast 生成、账本、治理、认证函数未改。
- `scripts/generate-cloudflare-worker.mjs`：仅只读模式 Edge cache 排除；运行时绑定/认证前缀不变。
- `lib/api.ts`、`lib/types.ts`：My Research opt-in URL 和只读元数据契约；其他 API 调用不变。
- `lib/my-research-data.ts`、`components/use-my-research.ts`：2×2渐进读取、源期限与本机期限、失败状态保留、短期负缓存。
- `lib/my-research.ts`、`components/my-research-workspace.tsx`：统一类型与完整性统计、缺失/来源时间展示；既有队列优先级与 baseline 规则不变。
- 测试：`tests/cloudflare-read-only-snapshot.test.ts`、`tests/fixtures/research-snapshot.ts`、`lib/my-research-data.test.ts`、`lib/my-research.test.ts`、`components/my-research-workspace.test.tsx`、`components/use-my-research.test.tsx`。
- 本地基准：`scripts/benchmark-read-only-snapshot.mjs`；本文及 `docs/benchmarks/my-research-read-only-2026-10-11.json`。

本轮未改 Portfolio、Dashboard、股票详情页的默认调用，手动预测生成保留。未改冻结首页、认证/密码/OAuth/session/admin、private storage、Production/Preview 配置或依赖锁文件。维护源函数对比仅已有 `route` 与 `readFrozenCloudForecast` 有变化，后者只抽取存储读；handle 仅排除只读请求的 metrics 写入。生成文件不单独维护。

## 仍需托管验收的风险

1. 不再执行模型计算，但仍须解析现有历史大 JSON，Worker 初始化、JSON/KV处理与 GC 仍可能超过 Free 10ms；没有承诺 20/50 实际托管成功率。
2. 未有生产者刷新这些隔离 KV 时，已有记录会过期或缺失。只读模式不会“修复”缺失覆盖率；需诚实显示 unavailable/stale。生产者或长期存算分离不在本轮范围。
3. CPU 超限会终止整个请求，无法被 JS 按资产 catch；2只同批仍可能一起失败。KV故障、配额、真实大预测记录、机房冷缓存延迟均未被合成测试覆盖。
4. Free 请求与 KV 读取用量会增加；50只为25个批量请求，没有50个 forecast HTTP。是否可恢复4只批次，必须以独立托管 CPU 验收为依据。
5. 本轮没有改动托管资源，也没有托管浏览器/真实 API 验收。下一步必须先获 Preview 部署授权。

回退：本轮为一个独立提交，可在 UI 分支 revert 整个提交并重新本地构建。回退会恢复原有可触发计算的 Snapshot 路径，不应将其当成已解决 Free CPU 问题；任何回退部署同样需要授权。
