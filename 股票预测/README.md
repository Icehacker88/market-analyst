# 多股票预测分析工具

这是一个个人日常参考用的股票/ETF 预测分析工具。你可以放入本地 CSV，也可以输入股票代码自动下载历史日线数据。工具会自动完成数据清洗、特征工程、模型训练、模型评估、未来 1 日和 5 日预测，并生成中文简短说明。

> 重要提示：本工具只用于个人研究和参考，不构成投资建议。

## 功能

- 支持本地 CSV 和在线 ticker 两种输入
- 支持单只股票和多只股票批量运行
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

### 3. 用本地 CSV 运行

```bash
python main.py --input data/raw/AAPL.csv
```

### 4. 生成专业投资日报

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
