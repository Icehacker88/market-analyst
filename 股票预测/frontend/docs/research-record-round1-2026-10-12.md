# Research Record — Round 1

2026-10-12（Asia/Kuala_Lumpur）。本地实现；未部署 Preview 或 Production。

基线 c5926b9；工作区 `/Users/icehacker/.codex/worktrees/orivane-ui/Market Analysis`，分支 `codex/ui-preview-ff7fd40d`。

## 使用路径

- 股票详情页搜索区下方提供「保存研究判断」，不依赖行情或预测加载成功。
- 填写看多/看空/中性、理由、主要风险，可选失效条件和复核日期。
- `/favorites/#research-records` 的「我的研究记录」支持查看、编辑和返回资产详情。不要求先关注资产。
- 日期和条件仅作个人记录，不进入自动待办、条件检测、验证或绩效计算；原有 research_reviews、复核计划、baseline 和待办规则保持不变。

## 数据和快照

新增可选 UserState.research_records，以稳定 UUID 为 key；记录 version=1，包含资产身份、方向、理由、风险、可选条件/日期、created_at、updated_at 及首次保存 snapshot。

快照只复制保存时当前页面已有且 symbol 一致的数据，不新增行情/预测请求：参考价格、行情日期、预测方向、1D/5D/1M 预测收益、预测日期、生成时间、模型名称。当前 Forecast 契约未提供整体模型版本，明确保存 model_version=null；已有 self_optimization.version 单独记录为 optimization_version，不冒充模型版本。未提供的数值、日期或预测对象均为 null，界面标为不可用。

编辑只更新个人字段和 updated_at；ID、created_at、资产身份和 snapshot 不变。缺失快照不会在刷新、重连或编辑时用后来的数据补填。允许同一资产保存多条独立判断，但不建立版本历史或绩效系统。

## 存储与兼容性

复用账号作用域 private storage、既有离线队列和 `/user/state` PATCH。未改变认证、session 或服务器授权。保存先核验本机写入；登录用户还核验离线队列，未确认时保留表单输入并提示失败。成功文案只确认本机保存，不冒称云端同步。

新增模块按稳定 ID 合并，避免初次云端读取前的离线记录覆盖已存在的其他云端研究记录。旧 UserState 自动补空 records，不迁移或覆盖 research_reviews；没有新增数据库、服务端 API 或 Worker 维护逻辑。

沿用现有 user state 同步能力和限制：没有服务端按记录的并发冲突解决；跨设备同时编辑同一记录仍按现有更新顺序覆盖，不宣称拥有历史版本。新模块保存体积受前端 240000 JSON 字符保护，保留服务端既有 250000 限制余量。没有新增删除操作。

## 验证

- 全部 48 个测试文件、281 项测试通过；typecheck 通过；Cloudflare build 通过（113 个静态页面，ORIVANE_SKIP_SEO_REFRESH=1）。
- 新增 11 项测试：快照完整/缺失/资产不一致、不可伪造模型版本、稳定 ID 编辑与原始快照不变、旧数据兼容、输入与容量校验、无行情创建、刷新恢复、本机保存失败保留输入、云端失败与离线恢复、游客/A/B 隔离、离线新记录与既有云端记录合并、既有复核计划保留。
- 生成后的 Worker 测试验证新增记录经既有 user-state PATCH/GET 往返，未丢失原复核计划。此处使用本地合成 session 夹具，仅测试状态 API；不代表真实托管密码登录验收。
- 真实本地构建页面以浏览器拦截模拟市场数据全部缺失：新增 → `/favorites/` 查看 → 刷新 → 编辑 → 原始快照不变 → 返回详情通过；不访问托管 API。
- 1440×1000、768×1024、390×844 的编辑器和记录列表无横向溢出；原生模态窗口可滚动，Escape 关闭并恢复编辑按钮焦点。无应用 pageerror。
- 本地模拟的 503/404 是主动缺失场景，不是线上故障或新应用异常。

截图与浏览器检查结果：`output/playwright/research-record-round1/`，截图包含 entry-1440、editor-1440/768/390、records-1440/768/390、snapshot-390。示例判断标明「本地验收示例」，不是用户真实投资记录或真实市场结论。

## 文件范围与冻结边界

- 新增：`lib/research-record.ts`，`components/research-records.tsx` 及独立 CSS，三个测试文件，本报告。
- 接入：`app/stocks/[slug]/page.tsx`、`components/dashboard.tsx`（仅显式开启股票页入口）、`components/favorites-page.tsx`。
- 新记录状态：`lib/types.ts`、`lib/user-state.ts`、`components/providers.tsx`（只增加研究记录保存和该模块的队列合并）。
- 冻结首页、My Research 只读 Snapshot、预测生成、复核队列、认证/密码/OAuth/管理员、Worker 生成器及全部 Cloudflare 配置未修改。

本轮仅本地提交，停止于本地验收；Preview 仍保留此前已验收部署，等待单独授权。
