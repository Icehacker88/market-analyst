# Orivane 版本隔离与后续开发入口

开始整理：2026-09-30；完成整理：2026-10-01（Asia/Shanghai）。只建立本地 Git 边界、工作区及文档；没有修改业务源码、认证行为、远端配置或部署，也没有 push。

## 结论与纠正

当前 Preview `ff7fd40d-0258-4689-950f-0509aaff1937` 是以 `f82c6be` 为 HEAD、包含未提交修改的工作区构建并上传，部署命令明确使用 `--commit-dirty=true`。Cloudflare 的 Source=`f82c6be` **不等于**该提交可独立复现线上代码。

管理员相关源码在首页第一轮开始前已经存在，随后随整个前端/Worker 构建一起部署。不能把“9 月 8 日没有部署”“9 月 30 日没有部署”误读为“这些修改从未部署”。本次直接读取固定部署的两个 JS 文件，严格 `is_admin` 判定及 `orivane-auth-rejected` 清理代码均存在，内容与 9 月 10 日留档逐字节一致。

因此，没有发现一组可以从当前 Preview 基线中剔除的、尚未部署的认证/管理员应用代码。剔除它们会成为认证回退，违反本次范围。未接入、未部署的是新密码候选算法及 benchmark 研究材料；真实密码登录和完整管理员验收仍未完成。

## 变更分类

| 类别 | 文件 / 范围 | 当前 Preview 关系 | 保存位置 |
| --- | --- | --- | --- |
| 已部署的原有提交 | `f82c6be` 及其父提交 | 基础代码；单独 checkout 不足以代表当前 Preview | 原 `main` 不移动 |
| 已有 session、跨账号隔离、管理员修改 | auth-provider、monitor-page、providers、private-storage、offline-store、admin、types、API 维护源及 Worker 生成器；其他组件中的私有存储调用 | 首页构建前即存在；源码快照和部署记录支持已随首页部署。管理员前端另有线上 JS 直接证据 | 源码 checkpoint `8306500` |
| Preview 环境/验证基础设施 | `wrangler.toml`、package/lock、测试文件 | Preview 隔离配置为既有配置；测试仅为本地验证材料，不作为客户端代码发布 | 同一源码 checkpoint；没有改生产配置 |
| 首页第一轮 | 11 个文件，含 `lib/api.ts` 首页资源通知部分；列表见下文 | 已部署到 ff7fd40d | 独立首页提交 `400a2cd` |
| 尚未部署的新密码研究 | 固定版本依赖、合成输入 benchmark、静态 WASM、历史本地结果，共 9 个显式选择文件 | 未接入运行时代码；非托管 CPU 验收 | 认证冻结分支的专用归档，不进入 UI 工作区 |
| 文档 | 根 `Market Analysis.md`、6 份既有 docs，以及本次报告/证据/工作区说明 | 不代表线上行为变更 | UI 分支单独文档提交；认证分支保存相关状态 |
| 其他本地文件 | `Market Analysis.md.zip`、忽略的 `.qa`、依赖、构建产物和本地环境文件 | 不作为新的 UI 部署源 | 保留原路径；ZIP 未加入提交，未复制凭据/QA session 到新工作区 |

源码 checkpoint 中的 `lib/api.ts`、`landing-page.tsx` 使用首页开始时留档，保留先前认证/私有存储改动；首页提交严格应用留存的 `round1-only.diff`，没有通过重写混合文件来分割代码。

首页提交的 11 个文件：

- `components/landing-page.tsx`
- `components/home-search.tsx`
- `components/home-discovery.tsx`
- `lib/home-discovery.ts`
- `components/use-home-resource.ts`
- `lib/api.ts`
- `components/home-scoreboard.tsx`
- `components/home-returning.tsx`
- `components/home.module.css`
- `app/globals.css`
- `components/home-round1.test.tsx`

## Git 边界

```text
f82c6be  原始 main（原工作区及暂存区不动）
└─ 8306500  已有认证/管理员/隔离源码 checkpoint
   ├─ 400a2cd  首页第一轮独立提交，重建当前 Preview 源码基线
   │  └─ codex/ui-preview-ff7fd40d：文档边界及后续 UI 工作
   └─ 704a86a → 78df7bf  密码研究归档及冻结状态文档
      codex/auth-admin-frozen-20260930
```

- 认证源码定位分支：`codex/auth-admin-source-20260930` → `8306500d6cbbb879d40c0313b811171171a60ec9`。
- 完整认证冻结分支：`codex/auth-admin-frozen-20260930` → `78df7bfa7bae32e9ca8a988b026976de44aa5e6c`。
- Preview 源码定位分支：`codex/preview-ff7fd40d-source` → `400a2cdd4d441e2a302d23feb8380c64b69e30b2`。
- 后续 UI 分支：`codex/ui-preview-ff7fd40d`。其新文档提交不改变上述源码基线。

密码归档位于冻结分支的 `股票预测/frontend/docs/checkpoints/password-benchmark-20260908.tar.gz`，SHA-256 `604656c552641fc931ba797e17317e7af15e71a534ef3bf30fcd3ce172d27b20`；对应文件清单和哈希位于相邻 manifest。未包含真实用户记录、会话夹具、secret 或 node_modules。不要将冻结分支合并或 cherry-pick 到 UI 分支。

## 后续 UI/产品开发入口

- 工作区：`/Users/icehacker/.codex/worktrees/orivane-ui/Market Analysis`
- 前端：`股票预测/frontend`
- 分支：`codex/ui-preview-ff7fd40d`
- 应用源码基线：`400a2cdd4d441e2a302d23feb8380c64b69e30b2`

原 `/Users/icehacker/Documents/Market Analysis` 仍位于原 `main`，保留原有未提交文件和忽略目录；不要从原目录继续构建新 UI Preview。新工作区不复制生产凭据、`.env`、认证夹具、密码 benchmark、旧构建输出和 node_modules。后续开发按需安装锁定依赖，重新生成 Worker，不能复用原目录的旧 `out`。

## 未来 Preview 部署会包含什么

1. 当前 ff7fd40d 对应的应用源码基线：既有 session/跨账号隔离/管理员逻辑及首页第一轮。
2. 仅在 UI 分支后续明确提交、检查过的页面/体验/性能修改。
3. 不包含冻结分支的密码候选、归档或未来认证修改；没有新 password scheme、OAuth、session、管理员授权变更。

本次没有部署许可。未来单独授权部署时，先与 `codex/preview-ff7fd40d-source` 比较应用 diff，检查被冻结的认证维护源、生成器和配置是否不变；共享 `lib/api.ts` 只能带入经确认的 UI 范围改动。明确目标 `codex/auth-phase1-preview`，重新核对六个 Preview KV、凭据隔离和跳过 SEO refresh；不要使用默认分支推断目标，不使用 `deploy:cloudflare:all` 或 optimizer 部署。不得切到 main 或合并认证分支来满足构建。

## 证据与验证边界

- 历史首页开始快照包含 145 个文件；与本次原目录比较仅 3 个已有文件不同（landing-page、lib/api、globals.css），与首页交付记录一致。认证源、生成 Worker 和配置哈希保持一致。
- 历史首页独立 patch 已在独立 Git index 中完整应用；结果与原工作区全部 36 个新增/修改源码、测试和配置文件逐字节一致。
- 固定部署两个 JS 实测 HTTP 200，哈希与归档相等，详见 `version-isolation-evidence-2026-09-30.json`。
- 没有独立下载 Cloudflare 托管 Worker 二进制，后端部署对应关系基于维护源/生成器/生成 Worker 哈希以及当时的构建上传记录；不是一次新的后端功能验收。
- 本步骤只做版本整理，不重跑测试或构建。上一轮 150 项测试、类型检查和 Cloudflare build 的日期仍为 9 月 30 日，不改称本步骤新结果。
- 原工作区源码和暂存区保持不变；本次仅补充/纠正文档。所有分支和提交仅在本地，不 push，不部署。
