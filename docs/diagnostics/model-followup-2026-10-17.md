# MODEL-SAFE-MODE / LEDGER-ARIMA-BIAS：第一轮离线诊断与实施建议

日期：2026-10-17（Asia/Kuala_Lumpur）；负责人：Codex；状态：诊断完成，待交叉审阅和实施范围确认。**没有修改应用或模型源码，没有调用生产 API、启动自动任务、写账本/KV、部署或调整套餐。** PR #11 仍待作者修订，本报告不以其因果结论为前提。

## 结论与优先级

| 优先级 | 已确认的发现 | 下一步及复杂度 |
| --- | --- | --- |
| P0（评估可信度） | 创建时间与目标结果日期存在异常：云端 149 条已结算 1D 中有 22 条被时间筛查标记；日报 348 条美国资产已结算样本中有 24 条。日期口径错误或延迟生成均可能影响“事前预测”资格 | 先核对数据日期、目标时段和生成时间；保留原记录并隔离待核验样本。中等，先做单独范围设计，不直接删除或改写历史 |
| P1 | ARIMA 的 CV 因 gap=1 缺少预测步长对齐；一次预测整个验证区间又与每日重拟合的真实使用方式不同 | 修复离线评估协议，先用合成时序和固定历史验证，暂不换模型。中等 |
| P1 | Python 选模评分混用了 holdout Return_RMSE/MAPE，holdout 不是完全独立的最终验收集 | 选模只用训练/内层 CV；最后一段只评估不选模。中等 |
| P1 | 治理没有独立的候选模型同资产同日期比较，watch 状态的模型标签也不能完整代表实际路由算法 | 先测试并明确状态/标签/资格；待有合格配对证据再决定候选晋级。中等；不能现在直接恢复 Router 或强行退出 Safe Mode |
| P2 | Safe Mode 当前冻结结果未发现权重组合时的符号翻转；ARIMA 不是所有资产都偏多 | 不反转信号、不全局降权、不按这批样本直接选择赢家 |

这里的 P0 是在发布新的模型优劣/命中率结论前应解决的证据门槛，不是本轮授权改动 Production。

## 固定证据与复现边界

- 云端维护源：产品提交 `934024859b9225e2465a5cc3170766a209ca7922` 的 `股票预测/frontend/netlify/functions/api.mts`；SHA256 `4f9aab2c20dff87c7cde8877f7cc96178c30db84d8f901f2c3ef630842f92532`。
- Python 源码与账本基准：main `38ad853ae8f84e1a41f648c8d7a3c413ef97914d`。PR #11 head `670c0a4` / 本诊断分支中的相应源文件相同。
- 账本 CSV：425 行、420 条已结算 1D，SHA256 `f3cddb8aec5f9e90b8ad2afd405457a0d1d4d47eb6a905ae9bb1e4d7734e0dda`。
- 云端输入来自作者保留的历史 JSON 导出，共 SPY 64、QQQ 35、NVDA 51 条。本次没有在线重新取数，未独立证明导出当时的服务状态。输入未纳入 Git，也没有读取用户私人数据。

| 导出文件 | SHA256 |
| --- | --- |
| ph_SPY.json | 62ba97369db53a2522250cd32d5c68e59063d166554a4884d4264a45aa98023f |
| ph_QQQ.json | 26c922f16f98cd6a3fb1178acdf764a0e83880727e55300774d759a4f544e83f |
| ph_NVDA.json | 4b6cbc96a1cac8598771b553aa2dd0fc690927b8f1d44eb16038b9f681be8e98 |

这些只是既有样本的描述统计。没有同资产同日期的 Router/Safe Mode 配对记录（0 对），不能用跨期命中率差证明切换模型造成退化。跨资产相关、预测窗口重叠、选择偏差和日期资格异常均未通过显著性检验消除。

## 1. Safe Mode：实际状态机与组合

维护源 `evaluateModelGovernance`（约 4665 行）：

1. 同一资产所有模型的已完成记录混合计算最近 20/60 样本；不按 Best_Model 筛选。
2. 不足 20 条为 warming_up；20 样本 edge ≤ −3，或准确率较 60 样本下降 ≥10 且 edge ≤0，为 rollback。
3. 否则 edge <1 或准确率下降 ≥6 为 watch，其余 stable。
4. 只有 previous=rollback 且本次初算 watch 且 edge<3 才继续 rollback。不是无条件永久锁定。

从固定维护源抽取纯函数的 7 项断言通过：负优势进入 rollback；0 优势初次 watch / 原先 rollback 则保留；+5 优势且无下降可以 stable；+5 优势但有明显准确率下降可进入 watch；不足 20 时重新 warming_up；更换 Best_Model 标签不改变统计结果。最后一条说明它不能区分“候选恢复”与“当前混合账本恢复”。这些是纯函数行为，不是托管 CPU 测量。

| 历史导出的当前已结算样本 | 近 20 准确率 | 近 20 edge | 假定 previous=stable / rollback 两种计算 |
| --- | --- | --- | --- |
| SPY | 25% | −30 pp | 均 rollback |
| QQQ | 30% | −30 pp | 均 rollback |
| NVDA | 50% | −10 pp | 均 rollback |

因此**仅删除粘性分支不能改变这批当前样本的回滚结果**。这里使用所有当下已结算结果，只是当前快照计算，不是把今天知道的结果倒灌成历史状态重放。

`cloudTrendForecast` 的 safeMode 会关闭 official Kronos、contextual signal、优化倍率；仍保留按 RSI/成交量/波动率/市场状态调整的基础权重。因此“未调权”不等于完全固定等权。watch/rollback 都把各周期结果替换为 ensemble；watch 的 active_model 却仍标为 Horizon Router，模型名称不能单独证明实际采用了逐周期候选路由。

已有 73 条 Safe Mode 都保存了 7 个组件和权重。按源码的加权求和及周期上限，1D/5D/10D/1M 全部可重建：最大绝对误差 ≤1.39e−17，符号不一致为 0。**未发现组合层整体取反的证据**；这不排除上游特征、时间对齐或单组件的问题，也未重算多年行情特征。

| 周期 | Safe Mode（已结算） | Trend 组件 | Mean Reversion 组件 |
| --- | --- | --- | --- |
| 1D | 27/72 = 37.5% | 24/72 = 33.3% | 50/72 = 69.4% |
| 5D | 22/66 = 33.3% | 33/66 = 50.0% | 41/66 = 62.1% |

组件比较使用同一条记录的结果，具备配对口径，但均值回归的优势仍是事后发现、未做独立留出验证。不能立即把它升为主模型；这些样本还包含时间资格待核验记录。

## 2. ARIMA：偏向、评估对齐与选模

280 条已结算 ARIMA：准确率 46.79%，预测为涨 72.14%，同批样本实际为涨 47.5%，多数类基准 52.5%，edge −5.71 pp。不能拿全账本 54.5% 的基准直接当作 ARIMA 自己的基准。

| 资产 | ARIMA 样本 | 预测涨占比 | 准确率 | 同样本多数类基准 |
| --- | --- | --- | --- | --- |
| SPY | 85 | 85.88% | 49.41% | 52.94% |
| QQQ | 85 | 71.76% | 48.24% | 51.76% |
| ^NDX | 84 | 72.62% | 42.86% | 51.19% |
| USDCNY=X | 26 | 26.92% | 46.15% | 57.69% |

6～10 月各月 ARIMA edge 均负（−12.77、−10.26、−10.61、−5.17、−3.23 pp），但资产构成与日期不同。Baseline 在 USDCNY 的 73.08% 也低于其同期多数类 76.92%；不能只按总体命中率把 ARIMA 换成 Baseline。

源码与探针确认：

- `ArimaReturnModel.predict(x)` 忽略 x 的内容和日期，只对训练 y 一次 forecast(len(x))。这导致较长验证窗口逐渐回到序列均值；若训练均值为正，容易产生连续看涨，但不是硬编码正号。实际 statsmodels 在正/负均值合成序列均能给出相应方向（两次拟合有 3 条非致命 warning，不作为效果证据）。
- `Target_Log_Return[t] = return[t+1]`。CV 使用 gap=1；合成索引样例：训练特征末行 28 → 已训练目标到 return[29]；第一步 forecast 是 return[30]，却拿去比较验证特征 30 对应的 return[31]。三个 fold 均差 1 步。未来修复必须按预测起点/目标日期对齐，不能直接去掉 gap 后宣称评估正确。
- 即使对齐缺口，一次给出未来 N 步也不等同于日报每天观察新行情后重新拟合的一步预测。需统一滚动起点评估与真实使用协议。
- 现有 CV 已计算 majority baseline、balanced accuracy 和 edge；`_model_prediction_score` 已给 edge 权重 2.4。问题不是完全没有基准。
- 排序同时扣除外层 holdout Return_RMSE/MAPE。保持所有 CV 指标不变，只改变 holdout 误差，探针中的赢家 A→B，说明这段 holdout 已参与模型选择，不能再作独立最终验收集。
- 所有候选较弱时仍选择排名第一的数值预测；负 CV 优势会让 Signal_Quality=Low、Action_Signal=Observe。本轮保留这一机制，不擅自删除数值或改动策略门槛。
- `except Exception` 静默退回训练中位数，没有在账本标明 fit failure/fallback。现有记录不足以量化多少历史 ARIMA 实际为 fallback。

## 3. 先处理时间资格，避免错误优化

诊断脚本采用**筛查而非正式交易日历规则**：仅 SPY/QQQ/NVDA/^NDX/^VIX，比较带时区的 Created_At 与 Actual_1D_Date 的 America/New_York 17:00。该阈值晚于通常日间收盘，用于发现明显时间异常；不验证早收市/节假日/扩展交易，也不判断 FX，不可直接部署为资格规则。

- 云端：检查 149 条，标记 22 条（20 Safe Mode、2 Router）。例：SPY As_Of=10-15、Actual=10-16，Created=10-17 00:16Z，即 10-16 美东 20:16。
- 日报：检查 348 条美国资产，标记 24 条（全 ARIMA）。例：QQQ As_Of=09-02、Actual=09-03，Created=09-04 08:58+08，即 09-03 美东 20:58。
- `_new_ledger_row` 使用日报开始时的 generated_at 写 Created_At。尚未核对每次历史运行的源行情、实际冻结时刻与日期转换，因此不能直接判定人为后见预测，也不能宣称这些样本全部合格。
- 敏感性分析仅作提示：去掉标记后，云端整体 1D 43.62%→46.46%（149→127）；日报 51.90%→52.53%（420→396，仍含未被筛查的 FX）。这不是“清洗后真实成绩”，也不能证明改模型会改善。

建议下一轮先核对少量代表日期的原始行情时间戳、As_Of_Date 生成逻辑、冻结 Created_At 与 Actual_*_Date 对齐。保留原始账本；若无法证明事前资格，统计中单列 pending/invalid，而不是覆盖时间或结果。真实存储/API变更需先确定兼容方案。

## 4. 建议实施顺序与验收

1. **评估与时间资格修复（优先，预计中等）**：限定 Python 评估及离线时间核验，主要文件 `src/models.py`、相关测试；若需改 `prediction_ledger.py` 另列明确兼容范围。验收包含带 gap 的日期对齐、逐起点只使用当时可见数据、改变最终 holdout 不影响已选模型、按资产和日期报告覆盖/弃权/失败。先固定样本，再保留一个未用于设计的新时间窗口；不得用同批数据调参后宣布提升。
2. **治理语义修复（中等）**：`evaluateModelGovernance` / `cloudTrendForecast` 及维护源测试。先把状态、实际计算路径和展示标签对齐，证明可退出、可重新进入、少样本降级与异常 fail-closed；不凭当前报告强行关闭 Safe Mode。无需先建新的后台系统。
3. **配对候选验证后再改晋级策略（较高，暂不实施）**：先利用已有冻结组件和离线可追溯输入，比较同资产同期间的候选及多数类基准；只有未来确有不可替代的数据缺口，才单独设计影子计算/存储方案。必须估算 CPU/KV 成本，不把额外模型计算放到普通页面请求，不预先启动任何生产任务。

两个任务保留 Codex 负责人，**本轮诊断交付标为 review，模型修复未完成**。推荐下一轮先批准第 1 项的具体本地实现范围；治理与影子预测不一并扩入。

## 复现与验证

`model_followup.py` 默认仅标准库离线统计；`--probe-python` 使用仓库已有的 numpy/pandas/sklearn/statsmodels。`governance_probe.mjs` 通过 TypeScript AST 抽取白名单纯函数，在没有 fetch/store/process/require 的 VM 上执行，不导入 Worker 模块。

```bash
# 在本 PR checkout；从明确提交导出源码/账本，不访问生产服务。
git show 934024859b9225e2465a5cc3170766a209ca7922:股票预测/frontend/netlify/functions/api.mts > /tmp/model-api.mts
git show 38ad853ae8f84e1a41f648c8d7a3c413ef97914d:股票预测/data/history/prediction_ledger.csv > /tmp/model-ledger.csv
python scripts/diagnostics/model_followup.py --ledger /tmp/model-ledger.csv --cloud /path/to/ph_SPY.json /path/to/ph_QQQ.json /path/to/ph_NVDA.json --probe-python
node scripts/diagnostics/governance_probe.mjs /tmp/model-api.mts /absolute/path/to/typescript /path/to/ph_SPY.json /path/to/ph_QQQ.json /path/to/ph_NVDA.json
python -m unittest discover -s scripts/diagnostics -p 'test_*.py' -q
```

缺少原导出时可省略 cloud 参数复现账本/合成探针，但不能声称重现了云端统计。不要用 `/predictions/history` 生产请求补齐：该 GET 可能结算账本、执行回测并写缓存。

本次环境 Python 3.13、Node 26；numpy 2.5.4 / pandas 3.0.6 / sklearn 1.9.1 / statsmodels 0.15.0。原有 Python 单元测试 22 项、诊断单元测试 5 项、治理纯函数断言 7 项通过；ARIMA 实现探针、固定输入复算通过。没有改变前端，因此本轮不重复前端构建，也不把离线结果称为托管验收。
