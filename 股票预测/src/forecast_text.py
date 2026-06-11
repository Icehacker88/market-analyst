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
