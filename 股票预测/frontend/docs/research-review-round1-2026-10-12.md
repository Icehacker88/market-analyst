# Research Review Round 1 — 本地实现与验收

日期：2026-10-12（Asia/Kuala_Lumpur）。基线 `2d139f9b45f747b514ddb374c7ae26363d6238bb`。
工作区为指定 UI worktree，分支 `codex/ui-preview-ff7fd40d`。本轮未部署 Preview 或 Production。

## 人工闭环

- 原 `research_records` 是唯一研究记录主体；新增 `userState.research_review_events` 保存其复核事件，按稳定事件 ID 索引，使用 `record_id` 关联。
- 同一资产的到期事项可以放在一张资产卡，但每条研究判断保留独立 record ID、到期时间、执行复核按钮。无需先加入 watchlist。
- 执行复核展示原始判断、理由、风险、失效条件及首次快照；当前参考数据仅在打开窗口时由现有只读 Snapshot 读取。缓存/失败/缺失明确展示，市场时效不作保证。
- 支持维持判断、调整方向、结束跟踪，必填复核理由和风险变化。继续跟踪可选择下次日期；留空则不安排下一次到期待办，但仍可主动执行复核。
- 每个事件保存版本、UUID、record ID、父事件 ID、时间、结论、方向、用户内容、下次日期，以及本次可用参考快照、数据读取状态、客户端接收时间。数据缺失保存 null，之后不补填。
- 到期按设备本地日历日判断，当天即进入待办；下次日期须晚于本次复核日期。没有自动价格检测、收益评价或准确率统计。
- 完成人工复核后，当前记录的到期任务立即更新；归档后不产生新到期任务，记录与历史仍可查看。该资产其他记录、旧复核计划和预测变化任务不被清除。

## 原始资料与兼容性

- 复核仅追加事件，不改原记录的 snapshot、created_at、原始方向/理由/风险，也不推进研究比较 baseline。
- 新创建的记录额外保存可选 `initial_judgment`，即使首次复核前编辑过正文，仍保留第一次保存的判断。
- 旧记录不回填该字段、不静默迁移。旧版本没有保存过的历史不可还原，执行复核时明确提示“旧记录未保存初始版本”。
- 已有复核事件后，记录不再提供覆盖式“编辑判断”，改用“执行复核”调整并留下历史；归档记录可查看，当前轮不提供重新启用。
- 既有 `research_reviews` 完全保留，其原有日期计划与本轮记录任务并行，不相互覆盖。
- 旧 `lib/research-review.ts` 计划辅助逻辑未修改；新增事件逻辑在 `lib/research-record-review.ts`。

## 本机、离线和云端

- 继续复用 private storage 的 guest/user scope、既有 offline queue、通用 user-state PATCH/GET。未改认证或服务端 API。
- 保存先写入并读回本机存储，登录账号还需确认队列条目存在，才更新 UI 待办。
- 提交期间锁定；失败后保留输入，重试使用同一事件 UUID；完全相同的事件幂等，冲突 ID 或过时的父事件拒绝覆盖。
- 事件按 ID 合并，已存在历史事件不被重试覆盖；恢复时合并远端事件与本机离线事件。研究记录与事件的合计模块大小限制在 240000 字符以内，超限拒绝并保留输入。
- UI 仅说“复核已保存到本机；云端同步尚未确认”，不根据离线写入或单次 PATCH 响应宣称跨设备同步完成。
- **限制**：沿用现有 JSON user-state 服务端写入语义，未引入服务端 CAS/事务或跨设备冲突仲裁。同一账号多个设备同时提交仍可能发生原有后写覆盖风险，本轮不宣称提供分布式幂等或并发事务保证。

## 验证

- 完整测试：50 个文件、294 项通过；typecheck、Cloudflare build、git diff --check 通过。
- 新增/补齐：缺数据人工复核、历史刷新恢复、维持/调整/归档、未来日期再到期、同资产两条记录独立任务、双击提交、失败重试、不可变原始内容、离线队列恢复、远端与离线历史合并、游客/A/B 隔离、旧记录与旧计划兼容。
- 生成后的 Worker 通用 user-state PATCH/GET 本地测试可保存/恢复事件，原记录与 research_reviews 不受影响。未修改维护源、生成器或生成代码。
- 本地真实浏览器：通过股票页创建两条 NVDA 示例判断，进入 favorites，分别调整并安排下一日期、结束另一条跟踪；队列逐条消失，刷新恢复两条事件；原记录完全不变，Escape 恢复触发按钮焦点。
- 1440×1000、768×1024、390×844：队列、复核表单和历史区截图，无横向溢出；弹窗内容可滚动，移动端保存按钮可达；pageerror=0。
- 从 favorites 单独打开窗口的网络检查：1 次 `/api/market/snapshot?symbols=NVDA&mode=read-only&v=2`，0 次 forecast HTTP。使用已有契约，未修改只读取数路径。
- UI 验收使用本地静态构建及受控缺失数据响应，账号隔离/队列/云端恢复使用测试替身；不是托管、真实账户或真实密码登录验收。
- 从股票页开始的完整 UI 脚本中可观察到原详情页的延迟 forecast 重试；独立 favorites 检查未出现。未扩大范围修改该既有详情请求行为。

截图和结果位于 `output/playwright/research-review-round1/`（本机验收产物，不提交大图）：
- `queue-1440/768/390.png`
- `editor-1440/768/390.png`、`form-1440/768/390.png`
- `history-1440/768/390.png`、`missing-data-390.png`
- `check.json`、`network.json`

## 文件边界

- 新增事件模型/日期/幂等逻辑及测试：`lib/research-record-review.ts`、对应测试。
- 新增复核编辑器、历史及测试：`components/research-review.tsx`、对应测试；抽取 `components/research-snapshot.tsx` 复用只读展示。
- 接入：research-records、my-research-workspace、my-research queue、types、user-state、providers；CSS 仅研究记录模块。
- 认证、密码、OAuth、管理员、冻结首页、只读 Snapshot、预测生成、Worker 维护源/生成器、Cloudflare 配置未变；未启动后台任务。

完成本地提交后停止。后续 Preview 部署和托管验收需另行授权。
