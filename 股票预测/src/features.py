from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import FEATURE_WINDOWS, LAG_WINDOWS, ROLLING_WINDOWS


def build_features(cleaned: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    data = _add_market_features(cleaned)
    data["Target_Log_Return"] = data["Log_Return"].shift(-1)
    data["Target_Price"] = data["Price"].shift(-1)
    data["Target_Direction"] = np.where(data["Target_Log_Return"] >= 0, "Up", "Down")

    feature_columns = infer_feature_columns(data)
    model_data = data.dropna(subset=feature_columns + ["Target_Log_Return", "Target_Price"])
    model_data = model_data.replace([np.inf, -np.inf], np.nan).dropna(
        subset=feature_columns + ["Target_Log_Return", "Target_Price"]
    )
    return model_data.reset_index(drop=True), feature_columns


def build_latest_feature_row(cleaned: pd.DataFrame, feature_columns: list[str]) -> pd.DataFrame:
    data = _add_market_features(cleaned)
    latest = data.replace([np.inf, -np.inf], np.nan).iloc[[-1]][feature_columns]
    if latest.isna().any(axis=None):
        missing = latest.columns[latest.isna().iloc[0]].tolist()
        raise ValueError(f"最新一行特征仍有缺失值，无法预测：{missing}")
    return latest


def build_technical_indicators(cleaned: pd.DataFrame) -> pd.DataFrame:
    return _add_market_features(cleaned)


def infer_feature_columns(data: pd.DataFrame) -> list[str]:
    excluded = {
        "Date",
        "Target_Log_Return",
        "Target_Price",
        "Target_Direction",
        "Open",
        "High",
        "Low",
        "Close",
        "Adj Close",
        "NAV",
    }
    return [
        col
        for col in data.columns
        if col not in excluded and pd.api.types.is_numeric_dtype(data[col])
    ]


def _add_market_features(cleaned: pd.DataFrame) -> pd.DataFrame:
    data = cleaned.copy()
    price = data["Price"]

    data["Daily_Return"] = price.pct_change()
    data["Log_Return"] = np.log(price / price.shift(1))
    data["Weekly_Return"] = price.pct_change(5)

    for window in FEATURE_WINDOWS:
        data[f"MA_{window}"] = price.rolling(window).mean()
        data[f"Price_to_MA_{window}"] = price / data[f"MA_{window}"] - 1

    for lag in LAG_WINDOWS:
        data[f"Price_Lag_{lag}"] = price.shift(lag)
        data[f"Return_Lag_{lag}"] = data["Log_Return"].shift(lag)

    for window in ROLLING_WINDOWS:
        data[f"Rolling_Mean_{window}"] = data["Log_Return"].rolling(window).mean()
        data[f"Rolling_Std_{window}"] = data["Log_Return"].rolling(window).std()
        data[f"Momentum_{window}"] = price / price.shift(window) - 1

    data["RSI_14"] = _rsi(price, 14)
    macd, macd_signal, macd_hist = _macd(price)
    data["MACD"] = macd
    data["MACD_Signal"] = macd_signal
    data["MACD_Hist"] = macd_hist
    bb_mid, bb_upper, bb_lower = _bollinger_bands(price)
    data["BB_Middle"] = bb_mid
    data["BB_Upper"] = bb_upper
    data["BB_Lower"] = bb_lower
    data["BB_Position"] = (price - bb_lower) / (bb_upper - bb_lower)

    if "Volume" in data.columns and data["Volume"].fillna(0).gt(0).any():
        data["Volume_Change"] = data["Volume"].pct_change()
        data["Volume_MA_5"] = data["Volume"].rolling(5).mean()
        data["Volume_MA_20"] = data["Volume"].rolling(20).mean()
        data["Volume_Ratio_20"] = data["Volume"] / data["Volume_MA_20"]

    return data


def append_next_feature_row(feature_data: pd.DataFrame) -> pd.DataFrame:
    if feature_data.empty:
        raise ValueError("没有足够数据生成下一期特征。")
    return feature_data.iloc[[-1]].copy()


def _rsi(series: pd.Series, window: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(window).mean()
    avg_loss = loss.rolling(window).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def _macd(series: pd.Series) -> tuple[pd.Series, pd.Series, pd.Series]:
    ema_12 = series.ewm(span=12, adjust=False).mean()
    ema_26 = series.ewm(span=26, adjust=False).mean()
    macd = ema_12 - ema_26
    signal = macd.ewm(span=9, adjust=False).mean()
    hist = macd - signal
    return macd, signal, hist


def _bollinger_bands(series: pd.Series, window: int = 20) -> tuple[pd.Series, pd.Series, pd.Series]:
    middle = series.rolling(window).mean()
    std = series.rolling(window).std()
    upper = middle + 2 * std
    lower = middle - 2 * std
    return middle, upper, lower
