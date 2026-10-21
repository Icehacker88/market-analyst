from __future__ import annotations

from typing import Mapping

import pandas as pd


def forecast_sentence(values: Mapping[str, object]) -> str:
    return (
        _period_forecast("明日", values.get("Forecast_1D_Return"))
        + "；"
        + _period_forecast("未来五日", values.get("Forecast_5D_Return"))
        + "。"
    )


def _period_forecast(period: str, value: object) -> str:
    if value is None or pd.isna(value):
        return f"预计{period}涨跌暂不可用"
    numeric = float(value)
    direction = "上涨" if numeric >= 0 else "下降"
    return f"预计{period}{direction} {abs(numeric):.2%}"


def arima_fallback_text(values: Mapping[str, object]) -> str:
    count, samples = values.get("ARIMA_CV_Fallback_Count"), values.get("ARIMA_CV_Samples")
    if count is None or samples is None or pd.isna(count) or pd.isna(samples) or float(samples) <= 0:
        return "ARIMA 验证回退比例：暂无数据。"
    return (f"ARIMA 验证回退：{int(count)}/{int(samples)}（{float(count) / float(samples):.1%}）；"
            "回退预测按中位数基线计入评分。")
