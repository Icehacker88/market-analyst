# 多股票预测分析工具

这是一个个人日常参考用的股票/ETF 预测分析工具。你可以放入本地 CSV，也可以输入股票代码自动下载历史日线数据。工具会自动完成数据清洗、特征工程、模型训练、模型评估、未来 1 日和 5 日预测，并生成中文简短说明。

> 重要提示：本工具只用于个人研究和参考，不构成投资建议。

## Orivane Web 应用

仓库现已包含可实际运行的 FastAPI + Next.js Web 应用。它直接复用现有 `src/` 数据获取、清洗、技术指标、模型训练、滚动验证、风险模型、`outputs/` 和真实预测账本，不生成虚假行情或预测。

公网地址：<https://orivane-market-intelligence.pages.dev/>

主要功能：

- 搜索 Yahoo Finance 股票、ETF、指数、汇率，以及东方财富 A股和公募基金
- 独立简洁首页，搜索或点击热门推荐后进入分析页
- 最多同时选择 5 个资产，URL 保存当前选择
- 实际价格与以区间首日为 100 的标准化走势对比
- 查看技术指标、最新模型预测、模型表现和真实历史预测准确率
- 手动触发重新分析；同一资产不会重复并发训练
- 收藏常看资产，并在独立收藏页面快速查看
- 中文 / English 与 Light / Dark 模式切换，偏好保存在浏览器
- 桌面、平板和手机响应式布局

### Web 系统架构

```text
backend/
  app/main.py              FastAPI 入口与 API 路由
  app/services/            搜索、行情、缓存、outputs、账本和预测任务适配层
  app/schemas/             Pydantic 请求与响应结构
  tests/                   后端核心测试
frontend/
  app/                     Next.js 页面：分析面板与收藏页
  components/              搜索、对比图、资产详情、主题和语言组件
  lib/                     API 客户端、类型、格式化和选择逻辑
src/                       原有预测核心逻辑，CLI 与 Web 共用
data/history/              原有真实预测账本
outputs/                   原有预测结果，Web 优先读取最新结果
```

### Web 本地安装

后端：

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

前端：

```bash
cd frontend
npm install
npm run dev
```

浏览器打开 `http://localhost:3000`。也可在 `股票预测/` 目录运行：

```bash
make dev
```

### Web 环境变量

- `backend/.env.example`：CORS 与缓存路径
- `frontend/.env.example`：后端 API 地址
- `.env.example`：可选 OpenAI 和邮件日报配置

核心网页不依赖 OpenAI API；没有 `OPENAI_API_KEY` 时搜索、行情、技术指标、预测、账本和收藏仍可使用。

### Web API

- `GET /api/health`
- `GET /api/assets/search?q=SPY`
- `POST /api/assets/resolve`
- `GET /api/market/history`
- `POST /api/compare`
- `GET /api/forecast/latest`
- `POST /api/forecast/run`
- `GET /api/forecast/status/{task_id}`
- `GET /api/performance/{symbol}`
- `GET /api/predictions/history/{symbol}`

所有 API 使用 Pydantic 校验、统一错误结构，并在响应前移除 `NaN` 和 `Infinity`。

### 收藏、搜索与预测

- 在资产概览或详情区点击收藏按钮，资产会保存到浏览器 `localStorage`。
- 顶部“收藏”入口打开快速查看页面。
- 搜索支持代码与名称；A股和公募基金会从云端补充名称与数据。
- 网页优先读取 `outputs/{symbol}/最新运行目录`，不会在刷新页面时重新训练。
- 只有点击“重新分析”才会调用现有 `src.pipeline.run_many()` 预测流程。

### 数据缓存

- 搜索结果：本地文件缓存 24 小时
- 历史行情与技术指标：本地文件缓存 4 小时
- 最新预测与模型表现：直接读取现有 `outputs/`
- 真实预测历史：继续读取 `data/history/prediction_ledger.csv`

缓存位于 `backend/data/cache/`，包含缓存版本、生成时间和请求参数，不提交到 Git。

### 测试与构建

```bash
make test
make build
```

等价命令：

```bash
python -m unittest discover -s tests -q
backend/.venv/bin/python -m pytest backend/tests -q
cd frontend && npm test
cd frontend && npm run typecheck
cd frontend && npm run build
```

### 生产部署

前端当前部署在 Cloudflare Pages，`frontend/functions/api/[[path]].ts` 由 `frontend/netlify/functions/api.mts` 自动生成并提供公网接口。部署前先把最新真实预测结果导出到公开数据包：

```bash
cd 股票预测
python scripts/export_public_web_data.py
cd frontend && npm run build
```

公网版本使用 Yahoo 获取实时行情和 A 股日线，并使用东方财富云端接口获取 A 股中文名称和公募基金净值；不依赖本机 AKShare。资产对比、搜索、收藏、语言/主题切换及已发布预测均可在线使用。不得把 `.env`、API Key 或 SMTP 密码提交到仓库。

### 数据源与合规限制

- Yahoo Finance 与 AKShare 都可能因上游限流、接口变化或市场休市返回失败；网页会显示真实错误，不会随机填充。
- 场外基金预测目标是下一次公布的净值，不是盘中实时成交价格。
- 真实历史准确率只统计已到目标日期并完成验证的冻结预测；回测表现与真实线上记录在页面中分开显示。
- 本工具仅用于研究和教育目的，不构成投资建议。历史表现不代表未来结果。

## 功能

- 支持本地 CSV、Yahoo Finance 和免费 AKShare 在线数据
- 支持单只股票和多只股票批量运行
- 支持通过 AKShare 读取A股前复权日线和公募基金净值；不会自动启用A股预测
- 自动识别 `Adj Close`、`Close` 或 `NAV` 作为价格字段
- 如果存在 `Volume`，会自动加入成交量分析和成交量特征
- 使用时间顺序划分训练集和测试集，避免随机切分导致的数据泄漏
- 输出模型比较、预测结果、未来滚动预测、图表和中文摘要
- 新增专业投资日报：市场技术面、模型预测、最近24小时新闻、GPT/本地中文市场解读
- 支持邮件发送和 GitHub Actions 每天北京时间 08:00 自动运行

## 项目结构

```text
data/raw/              放本地 CSV 原始数据
data/processed/        预留给后续统一保存处理后数据
outputs/               每次运行的结果目录
src/                   核心源码
main.py                命令行入口
README.md              使用说明
.github/workflows/     每日自动运行配置
```

## 安装依赖

当前实现使用常见 Python 数据分析库：

```bash
pip install pandas numpy matplotlib seaborn scikit-learn statsmodels requests
```

可选增强组件：

```bash
pip install xgboost shap tensorflow
```

如果没有安装这些增强组件，工具会自动跳过，不会伪造结果。

## 使用方法

### 1. 用在线股票代码运行

```bash
python main.py --ticker SPY --start 2016-01-01
```

### 2. 批量运行多个 ticker

```bash
python main.py --tickers AAPL MSFT NVDA SPY --start 2016-01-01
```

### 3. 使用免费 AKShare 数据源

AKShare 免费且不需要 Token。为避免增加现有 GitHub 日报安装时间，它作为可选依赖单独安装：

```bash
pip install -r requirements-free-data.txt
```

读取A股前复权日线时可使用 `.SH`、`.SZ`、`.BJ` 后缀，也可直接使用六位代码。只有显式运行以下命令时才会预测A股，现有投资日报仍使用 Yahoo Finance：

```bash
python main.py --ticker 600519.SH --data-source akshare --asset-type market --start 2016-01-01
```

读取公募基金净值并单独运行预测：

```bash
python main.py --ticker 016452.OF --data-source akshare --asset-type fund --start 2022-11-29
```

AKShare 使用公开网站数据，免费但接口可能随上游网站调整而变化。A股日线默认从东方财富读取，失败时自动回退到腾讯证券前复权数据。对于场外 QDII 基金，模型预测目标是下一次公布的基金净值方向和变化，不是盘中可成交价格；净值还会受汇率、估值时差、费用和跟踪误差影响。

### 4. 用本地 CSV 运行

```bash
python main.py --input data/raw/AAPL.csv
```

### 5. 生成专业投资日报

```bash
python main.py --daily-report --market-start 2024-01-01
```

可用 `--ledger-path` 指定真实预测账本位置；默认使用 `data/history/prediction_ledger.csv`。

投资日报会自动分析：

- `^NDX`：纳斯达克100
- `SPY`
- `QQQ`
- `^VIX`
- `USDCNY=X`

同时抓取最近24小时新闻关键词：

- Fed
- CPI
- PPI
- Jobs
- NVIDIA
- Microsoft
- Apple
- Amazon
- Meta
- Google

日报输出目录示例：

```text
outputs/daily_reports/20260608_080000/summary.md
```

如果设置了 `OPENAI_API_KEY`，工具会调用 OpenAI Responses API 生成 GPT 中文市场解读。没有 API Key 时，会自动使用本地规则生成简版中文解读，不会中断运行。

CSV 至少需要包含：

- `Date`
- `Adj Close`、`Close` 或 `NAV` 其中之一

可选字段：

- `Open`
- `High`
- `Low`
- `Volume`

## 输出文件

每只股票每次运行会生成一个独立目录，例如：

```text
outputs/SPY/20260608_101530/
```

主要文件包括：

- `cleaned_prices.csv`：清洗后的价格数据
- `processed_features.csv`：建模特征数据
- `prediction_results.csv`：所有模型的测试集预测结果
- `best_model_predictions.csv`：最佳模型预测结果
- `model_comparison.csv`：模型表现比较
- `forecast_1d_5d.csv`：未来 1 日到 5 日滚动预测
- `summary.md`：中文简短预测分析说明
- `run_metadata.md`：运行信息和特征列表
- `figures/`：价格趋势、收益率、波动率、成交量、预测对比、特征重要性图

投资日报会额外输出：

- `summary.md`：专业投资日报
- `summary.html`：更美观的 HTML 邮件正文，包含市场表格、模型表格和关键图表
- `market_snapshot.csv`：市场技术面快照
- `market_snapshot.md`：市场技术面说明
- `news_24h.csv`：最近24小时新闻
- `news_24h.md`：新闻摘要
- `daily_model_predictions.csv`：市场资产模型预测汇总
- `prediction_ledger_snapshot.csv`：截至本次运行的真实预测账本快照
- `prediction_ledger_metrics.csv`：最近 20、60、120 日和全部历史的真实预测表现
- `latest_prediction_validation.csv`：各资产最新一笔已完成的“预测收益 vs 实际收益”验证结果
- `email_status.txt`：邮件发送状态

## 模型说明

默认模型包括：

- Baseline：用最近收益率作为简单基准
- Linear Regression：线性回归，便于解释
- Random Forest：主要非线性模型
- Logistic Direction：专门预测下一交易日涨跌方向的逻辑回归分类模型
- Extra Trees Direction：专门预测下一交易日涨跌方向的树模型
- ARIMA：传统时间序列模型

默认在训练区间内进行带间隔的滚动时间序列交叉验证。只有当候选模型稳定超过多数类方向基准时，才优先采用方向模型；否则继续选择价格误差更低的模型。最后保留测试集用于报告样本外表现。选中最佳模型后，会使用全部可用历史重新训练，再生成未来 1 日和 5 日预测。

报告同时展示测试集方向准确率、多数类基准、方向优势和滚动验证方向准确率。多数类基准用于识别“市场本来多数时间上涨”造成的虚高准确率；方向优势为负时，说明模型没有胜过简单多数类判断。行动信号只依据训练区间内滚动验证决定；未形成稳定方向优势时显示 Observe，并保留原始预测用于研究。

日报还会训练独立的未来 5 日风险状态模型，预测未来实现波动率是否高于当前 20 日波动率，并输出高波动概率、风险状态和滚动验证 AUC。方向信号质量只使用训练区间内滚动验证，不使用测试集决定当日信号。

日报和邮件会为每个资产统一展示“预计明日上涨/下降 X%；预计未来五日上涨/下降 X%”。

`data/history/prediction_ledger.csv` 会冻结每天首次生成的预测，并在后续交易日自动补齐真实 1 日方向和 5 日风险结果。日报和邮件会展示各资产上一笔已完成预测的预测收益、实际收益、收益误差、方向验证，以及最近 60 次真实方向准确率和平均绝对收益误差。GitHub Actions 每日运行后只持久化该账本，不提交日报输出文件。

## GPT 市场分析配置

可选环境变量：

```bash
export OPENAI_API_KEY="你的 OpenAI API Key"
export OPENAI_MODEL="gpt-5-mini"
export OPENAI_MAX_OUTPUT_TOKENS="1200"
export OPENAI_RETRY_ATTEMPTS="3"
export GPT_NEWS_LIMIT="12"
export DISABLE_GPT_ANALYSIS="false"
```

如果不配置 `OPENAI_API_KEY`，日报仍会生成，只是 `GPT市场分析` 部分会使用本地规则 fallback。当前 GitHub Actions 邮件日报默认设置了 `DISABLE_GPT_ANALYSIS=true`，因此邮件不会调用 OpenAI API，也不会产生 API 费用。

可选参数说明：

- `OPENAI_MODEL`：用于市场解读的模型，默认 `gpt-5-mini`。
- `OPENAI_MAX_OUTPUT_TOKENS`：限制 GPT 输出长度，默认 `1200`，可以控制成本和运行时间。
- `OPENAI_RETRY_ATTEMPTS`：调用失败后的重试次数，默认 `3`。
- `GPT_NEWS_LIMIT`：传给 GPT 的新闻条数，默认 `12`。完整新闻仍会保存在 `news_24h.csv` 和 `news_24h.md`。
- `DISABLE_GPT_ANALYSIS`：设置为 `true` 时强制使用本地规则解读，不调用 OpenAI API。

如果日报显示 `local_fallback_api_error`，说明已经尝试调用 GPT，但 API 返回错误。最常见原因是 OpenAI 账号额度、Billing、项目 Limits 或短时间请求过多。此时工具会自动退回本地规则解读，避免整份日报失败。

## 邮件发送配置

运行日报后自动尝试发送邮件。邮件正文会优先使用 `summary.html`，并内嵌关键图表；同时会把 `summary.md` 作为附件发送。需要配置：

```bash
export REPORT_EMAIL_TO="your_email@example.com"
export SMTP_HOST="smtp.example.com"
export SMTP_PORT="587"
export SMTP_USER="your_smtp_user"
export SMTP_PASSWORD="your_smtp_password"
export SMTP_FROM="your_email@example.com"
export SMTP_SECURITY="auto"
```

也可以命令行指定收件人：

```bash
python main.py --daily-report --email-to your_email@example.com
```

如果邮箱或 SMTP 没配置完整，工具会跳过邮件发送，并在 `email_status.txt` 写明原因。

SMTP 加密方式说明：

- `SMTP_SECURITY=auto`：默认推荐。端口 `465` 自动使用 SSL，其他端口自动使用 STARTTLS。
- `SMTP_SECURITY=ssl`：适合 465 端口。
- `SMTP_SECURITY=starttls`：适合 587 端口。
- `SMTP_SECURITY=plain`：不加密，通常不推荐。

常见配置：

```bash
# Gmail / Outlook 常见方式
SMTP_PORT=587
SMTP_SECURITY=starttls

# 部分邮箱服务商使用
SMTP_PORT=465
SMTP_SECURITY=ssl
```

## GitHub Actions 自动运行

已新增：

```text
.github/workflows/daily-market-report.yml
```

它会每天 UTC 00:00 自动运行，也就是北京时间 08:00。当前邮件日报默认使用本地解读，不调用 OpenAI API。你需要在 GitHub 仓库里配置以下 Secrets：

- `GPT_NEWS_LIMIT`：可选 Repository Variable，默认 `12`
- `REPORT_EMAIL_TO`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_FROM`
- `SMTP_SECURITY`：可选，也可配置为 Repository Variable；不填时默认 `auto`

## 特征说明

工具会自动生成常用金融特征：

- MA5、MA10、MA20、MA50
- Price Lag 和 Return Lag
- Daily Return、Log Return、Weekly Return
- Rolling Mean、Rolling Std、Volatility
- Momentum
- RSI
- MACD
- Bollinger Bands
- Volume rolling features，如果存在成交量

## 注意事项

- 建议使用至少 1 年以上日线数据，数据越少模型越不稳定。
- 股票市场具有非平稳性，历史表现不能保证未来表现。
- 未来 5 日预测采用滚动方式，只适合短期趋势参考。
- 如果数据缺失严重、价格字段错误或样本过少，工具会直接报错，而不是生成不可靠结果。
