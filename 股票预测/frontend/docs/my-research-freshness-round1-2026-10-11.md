# My Research Freshness Semantics — Round 1

日期：2026-10-11。仅本地实现与验证，未部署 Preview 或 Production。
工作区：`/Users/icehacker/.codex/worktrees/orivane-ui/Market Analysis`。
分支：`codex/ui-preview-ff7fd40d`。基线：`2a0db68`。

## 实现范围

仅 `/favorites/` 的状态投影、统计、来源详情与对应测试。原有 transport/cache 状态继续由现有 loader 管理；展示层拆为三个独立维度，不更改读取路径或缓存契约。

- 执行：processed / failed / unchecked。失败后保留旧值不计入成功读取。
- 成功读取完整性：complete / partial / unavailable。
- 时效：分别显示客户端接收年龄、行情 KV 存储年龄与服务端复用截止、行情 data_as_of、预测生成时间与复用截止。缺失时间显示未提供，不推断。
- Stale 为独立超期指标：包括部分资产及失败后保留旧值中的超期来源，每资产最多计一次。仅未知年龄或日期不一致不等同已证明超期。
- 市场时效一律待核验。本轮无交易日历或收盘完整性证据，不因周末把缓存标为新鲜；复用期限不等同市场时效或预测结论有效期。
- Checked 沿用既有 completeResearchEntry 准入，未改变基准写入、初始建基准或待办逻辑。

恒等式：complete + partial + unavailable = processed；processed + failed + unchecked = total。Stale 不参与上述求和。

## 本地验证

全部 45 个测试文件、270 项测试通过；typecheck 通过；Cloudflare build 通过（113 个静态页面，ORIVANE_SKIP_SEO_REFRESH=1）。

真实公开样例来自上一轮已验收 Preview 的 50 资产 Snapshot 响应，原始采集时点为 2026-10-10T19:41:43.355Z（当地 10 月 11 日）。保存为 tests/fixtures/research-read-only-50.json；无账户、凭据或私有用户状态。本轮仅离线回放，不代表本轮重新获取托管数据。

| 本地回放 | Processed | Complete | Partial | Unavailable | Stale | Checked | Snapshot 请求 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 5 | 5 | 0 | 0 | 5 | 0 | 3 |
| 20 | 20 | 15 | 5 | 0 | 20 | 0 | 10 |
| 50 | 50 | 15 | 10 | 25 | 25 | 0 | 25 |

完整、部分、缺失、预测超期、行情缓存超期、客户端超期、未知时间、日期不一致、混合执行状态、首次无 baseline、失败保留旧值均有覆盖。50 只全部刷新失败后：Processed/Complete/Partial/Unavailable 均为 0，Failed=50，Stale=25，Checked=0；仍保留原有价格，不生成新基准或重要事项。

本地浏览器回放在 5/20/50 × 1440×1000、768×1024、390×844 九种组合验证：无横向溢出、列表数量完整，顺序仍为今天需要处理 → 我的关注 → 最近查看。来源详情区分原始日期与客户端接收时间；修正首次异步收数后短暂显示客户端年龄未知的问题。没有应用 pageerror。Logo 404 由本地测试主动模拟以验证现有 fallback，不是线上故障采集。

截图（本地回放，目录 output/playwright/freshness-round1）：
- favorites-50-1440.png
- favorites-50-768.png
- favorites-50-390.png
- sources-390.png
- failed-retained-390.png

浏览器结果保存在同目录 check.json。截图与运行输出为本地验收产物，不进入应用提交。

## 冻结边界

未修改 API、只读 Snapshot 核心路径、默认 Snapshot、预测生成、Worker 维护源或生成器、云端配置、认证/密码/OAuth/管理员、首页、股票详情、Portfolio、optimizer、Kronos 或 GitHub Actions。completeResearchEntry、researchSnapshot、read/write/seedResearchBaseline、buildResearchQueue 与基线实现一致。未新增数据字段或迁移。

本轮不证明新的托管 CPU 性能，也不确认市场数据对应最近有效交易时段；这些能力仍需单独验收或可靠来源证据。此次仅本地提交，等待独立 Preview 部署授权。
