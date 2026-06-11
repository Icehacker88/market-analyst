from __future__ import annotations

import math
from pathlib import Path

import pandas as pd

from src.forecast_text import forecast_sentence
from src.models import actionable_signal, classify_signal_quality, optional_model_status
from src.preprocessing import DataQualityReport


def write_summary(
    ticker: str,
    quality: DataQualityReport,
    metrics: pd.DataFrame,
    forecast: pd.DataFrame,
    output_dir: Path,
    figure_paths: dict[str, Path],
    optional_status: pd.DataFrame | None = None,
    risk_forecast: pd.DataFrame | None = None,
) -> Path:
    best = metrics.iloc[0]
    latest_forecast = forecast.iloc[0]
    five_day = forecast.iloc[-1]
    signal_quality = classify_signal_quality(best)
    signal = actionable_signal(latest_forecast["Predicted_Direction"], signal_quality)
    risk = risk_forecast.iloc[0] if risk_forecast is not None and not risk_forecast.empty else None
    latest_price = float(forecast.iloc[0]["Predicted_Price"]) / float(
        math.exp(forecast.iloc[0]["Predicted_Return"])
    )
    five_day_return = float(five_day["Predicted_Price"]) / latest_price - 1
    forecast_values = {
        "Forecast_1D_Return": latest_forecast["Predicted_Return"],
        "Forecast_5D_Return": five_day_return,
    }
    optional_status = optional_status if optional_status is not None else optional_model_status()
    path = output_dir / "summary.md"
    lines = [
        f"# {ticker} 预测分析简报",
        "",
        "## 数据概况",
        "",
        f"- 数据时间范围：{quality.start_date} 至 {quality.end_date}",
        f"- 清洗前记录数：{quality.rows_before}",
        f"- 清洗后记录数：{quality.rows_after}",
        f"- 使用价格字段：{quality.price_column}",
        f"- 删除重复日期：{quality.duplicate_dates_removed}",
        f"- 删除无效或非正价格行：{quality.nonpositive_price_rows_removed}",
        f"- 是否包含成交量：{'是' if quality.has_volume else '否'}",
        "",
        "## 模型表现",
        "",
        f"- 当前最佳模型：{best['Model']}",
        f"- RMSE：{best['RMSE']:.4f}",
        f"- MAE：{best['MAE']:.4f}",
        f"- MAPE：{best['MAPE']:.2f}%",
        f"- 测试集方向准确率：{best['Directional_Accuracy']:.2f}%",
        f"- 测试集多数类基准：{best['Majority_Baseline_Accuracy']:.2f}%",
        f"- 测试集方向优势：{best['Directional_Edge']:.2f} 个百分点",
        f"- 滚动验证方向准确率：{best['CV_Directional_Accuracy']:.2f}%",
        f"- 滚动验证方向优势：{best['CV_Directional_Edge']:.2f} 个百分点",
        "",
        "## 近期预测",
        "",
        f"- 行动信号：{signal}",
        f"- 信号质量：{signal_quality}",
        f"- 下一交易日预测方向：{latest_forecast['Predicted_Direction']}",
        f"- 下一交易日预测收益率：{latest_forecast['Predicted_Return']:.4%}",
        f"- 下一交易日预测价格：{latest_forecast['Predicted_Price']:.4f}",
        f"- 第 5 个交易日滚动预测价格：{five_day['Predicted_Price']:.4f}",
        f"- {forecast_sentence(forecast_values)}",
        "",
        "## 未来 5 日风险状态",
        "",
        (
            f"- 风险状态：{risk['Risk_5D_Status']}\n"
            f"- 高波动概率：{risk['Risk_5D_Probability']:.2%}\n"
            f"- 风险模型：{risk['Risk_5D_Model']}\n"
            f"- 滚动验证 AUC：{risk['Risk_5D_CV_AUC']:.3f}"
            if risk is not None
            else "- 风险模型暂不可用。"
        ),
        "",
        "## 可选组件状态",
        "",
    ]
    for _, row in optional_status.iterrows():
        lines.append(f"- {row['Component']}：{row['Status']}")

    lines.extend(
        [
            "",
            "## 图表文件",
            "",
        ]
    )
    for name, figure_path in figure_paths.items():
        lines.append(f"- {name}：{figure_path.name}")

    lines.extend(
        [
            "",
            "## 风险提示",
            "",
            "- 预测结果只适合作为个人研究和日常参考，不构成投资建议。",
            "- 股票和 ETF 价格受宏观、新闻、流动性和突发事件影响，历史规律不保证未来继续有效。",
            "- 工具使用时间顺序切分训练集和测试集，避免随机切分导致的数据泄漏，但短期预测仍可能出现较大误差。",
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def write_run_metadata(
    output_dir: Path,
    source: str,
    ticker: str,
    feature_columns: list[str],
    quality: DataQualityReport,
) -> Path:
    path = output_dir / "run_metadata.md"
    missing_after = ", ".join(
        f"{key}: {value}" for key, value in quality.missing_after.items()
    )
    lines = [
        f"# {ticker} 运行信息",
        "",
        f"- 数据来源：{source}",
        f"- 特征数量：{len(feature_columns)}",
        f"- 日期范围：{quality.start_date} 至 {quality.end_date}",
        f"- 清洗后缺失值：{missing_after}",
        "",
        "## 特征列表",
        "",
    ]
    lines.extend(f"- {feature}" for feature in feature_columns)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path
