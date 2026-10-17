# Core User Journey Polish — Round 1

## 交付状态

- 本地实现及验收完成，未部署 Preview 或 Production。
- 工作区：`/Users/icehacker/.codex/worktrees/orivane-ui/Market Analysis`。
- 分支：`codex/ui-preview-ff7fd40d`；父提交：`d809dd69f14e871751c5e64f3baed043473640c6`。
- 本文随本轮唯一提交保存；提交 SHA 以 Git 记录为准。

## 行为变更

1. 判断与复核编辑器每次输入均保存到既有账号隔离本机存储。新判断按资产、编辑与复核按稳定 record ID 区分；不上传草稿。关闭或 Escape 保留草稿，取消提供页内继续编辑/放弃确认；刷新可以恢复。存储失败明确提示，不只依赖 beforeunload。保存成功清除对应草稿。
2. 登录恢复期间禁止写入；复用现有 provider 的 pending/账号切换卸载及作用域保护。复核草稿保留打开时 parent ID；冲突不能静默重设父事件。失败重试保持事件 ID 与快照。
3. `/analysis/` 的明确单资产选择复用现有判断编辑器；多资产、身份未明确或 active 不一致时不提供操作。已有快照 symbol 校验继续生效；无行情/预测可保存，缺失值仍为 null。
4. 复核实际本机持久化成功后显示反馈及精确历史事件链接，待办消失不会带走反馈。刷新后可以通过最近完成复核找到历史；归档明确说明停止跟踪、保留历史。
5. 当前方向与最近复核理由/风险变化优先展示，初始判断与首次快照独立折叠。旧记录没有初始版本时不伪造。归档徽标和判断方向分开。
6. 主导航统一“我的研究”，加入研究记录定位入口；旧价格/条件复核计划独立命名。游客只声明此设备保存，登录用户不宣称未经确认的云端同步。

## 修改文件

全部相对 `股票预测/frontend/`：

| 文件 | 用途 |
| --- | --- |
| `lib/research-draft.ts` | 本地草稿格式、校验与保存范围文案 |
| `components/use-research-draft.tsx` | 隔离草稿恢复/写入/清除、离开保护、放弃提示 |
| `components/research-records.tsx` | 编辑器草稿、单资产入口、当前/原始判断分组 |
| `components/research-review.tsx` | 复核草稿与父版本校验、完成提示、历史事件定位 |
| `components/research-records.module.css` | 保存反馈与历史定位样式 |
| `components/my-research-workspace.tsx` | 不随待办卸载的反馈、最近历史、准确空状态及旧计划名称 |
| `components/dashboard.tsx` / `app/analysis/page.tsx` | 复用明确单资产保存入口 |
| `components/header.tsx` / `components/research-navigation.tsx` | 导航命名及研究记录入口 |
| `components/favorites-page.tsx` | 本机/云端未确认状态文案 |
| `components/detail-panel.tsx` | 旧价格/条件计划说明 |
| `components/core-journey.test.tsx` | 15 项新增核心旅程回归测试 |
| `components/research-records.test.tsx` / `components/research-review.test.tsx` | 更新分组及反馈断言 |
| 本报告 | 本地验收结果与边界 |

## 验证结果

- 完整前端测试：51 个测试文件、309 项通过（包含 Worker 相关既有测试；未改变 Worker）。
- `npm run typecheck`：通过。
- `ORIVANE_SKIP_SEO_REFRESH=1 npm run build:cloudflare`：通过。
- `git diff --check`：通过。
- 新测试覆盖：写一半关闭/刷新恢复、主动放弃、保存后清除、游客/A/B 隔离、登录恢复禁止误写、同资产多记录草稿、过时父事件拒绝、保存失败保留稳定事件及快照、存储配额失败、单资产缺失数据、错误 symbol 与多资产保护、待办消失后的成功反馈、历史刷新恢复、当前/原始判断区分、归档与旧记录。
- 浏览器实测：AAOG 通用分析入口；无行情和预测时创建判断；判断/复核草稿关闭与刷新恢复；取消页内确认及放弃后空草稿；调整后原始理由仍保留；归档后看空方向与归档独立显示，历史 2 次；历史链接定位具体事件；刷新后的最近历史入口。
- 1440×1000、768×1024、390×844：检查记录、历史与编辑器，无页面横向溢出；长表单在弹窗内滚动。
- 最后一次 favorites 页面控制台检查：未捕获 error/warn。分析页面使用故意失败的本地行情/预测响应验证缺失态；这些 HTTP 503 是测试条件，不是托管可用性结论。

## 截图

本地绝对目录：`/Users/icehacker/.codex/worktrees/orivane-ui/Market Analysis/股票预测/frontend/output/playwright/core-journey-polish/`（输出文件不纳入 Git）。

- `judgment-draft-1440.jpg`、`judgment-draft-768.jpg`、`judgment-draft-390.jpg`：三档判断草稿编辑器。
- `aaog-entry-1440.jpg`：AAOG 通用单资产分析保存入口。
- `review-saved-1440.jpg`：归档本机成功反馈与精确历史定位。
- `history-768.jpg`、`history-390.jpg`：平板/移动历史定位。
- `records-390.jpg`：移动当前判断、归档、原始判断/历史入口。

## 范围与验证局限

- 浏览器验收使用本地 Cloudflare 静态构建及受控缺失数据服务，不代理 Production，不触发数据生产。不是托管 Preview 验收或真实密码登录验收。
- 账号切换、离线持久化失败、远端父版本变化由使用真实 Providers/PrivateStorage 的自动化测试模拟；本轮没有真实云端 PATCH/GET 或跨设备同步验收。
- 草稿仅本机保存，浏览器清除存储会删除草稿；存储不可用时无法承诺刷新恢复，会明确提醒复制内容。
- 未增加 user state 云端字段或 API；未修改认证/密码/OAuth/管理员、冻结首页搜索或资产发现、只读 Snapshot、预测生成、历史不可变库、Worker 维护源/生成器、Cloudflare 配置、optimizer/Kronos/GitHub Actions。
- 旧 research_reviews 与 My Research baseline 的读写逻辑不变。
- 下一步必须等待独立 Preview 部署授权，本轮停止。
