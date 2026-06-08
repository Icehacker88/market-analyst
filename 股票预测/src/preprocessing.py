from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


REQUIRED_DATE_CANDIDATES = {"date", "datetime", "time", "timestamp"}
COLUMN_ALIASES = {
    "adj close": "Adj Close",
    "adj_close": "Adj Close",
    "adjusted close": "Adj Close",
    "adjusted_close": "Adj Close",
    "close": "Close",
    "open": "Open",
    "high": "High",
    "low": "Low",
    "volume": "Volume",
    "vol": "Volume",
    "nav": "NAV",
    "fund nav": "NAV",
    "fund_nav": "NAV",
}


@dataclass
class DataQualityReport:
    rows_before: int
    rows_after: int
    start_date: str
    end_date: str
    missing_before: dict[str, int]
    missing_after: dict[str, int]
    duplicate_dates_removed: int
    nonpositive_price_rows_removed: int
    price_column: str
    has_volume: bool


def clean_price_data(raw: pd.DataFrame) -> tuple[pd.DataFrame, DataQualityReport]:
    rows_before = len(raw)
    missing_before = raw.isna().sum().astype(int).to_dict()
    data = raw.copy()
    data.columns = [_normalize_column_name(col) for col in data.columns]

    date_column = _find_date_column(data)
    data = data.rename(columns={date_column: "Date"})
    data["Date"] = pd.to_datetime(data["Date"], errors="coerce")
    data = data.dropna(subset=["Date"])

    for column in ["Open", "High", "Low", "Close", "Adj Close", "Volume", "NAV"]:
        if column in data.columns:
            data[column] = pd.to_numeric(data[column], errors="coerce")

    price_column = _choose_price_column(data)
    data["Price"] = data[price_column]
    duplicate_dates_removed = int(data["Date"].duplicated().sum())
    data = data.sort_values("Date").drop_duplicates("Date", keep="last")

    nonpositive_mask = data["Price"].le(0) | ~np.isfinite(data["Price"])
    nonpositive_price_rows_removed = int(nonpositive_mask.sum())
    data = data.loc[~nonpositive_mask].copy()

    usable_columns = [
        col
        for col in ["Date", "Open", "High", "Low", "Close", "Adj Close", "NAV", "Volume", "Price"]
        if col in data.columns
    ]
    data = data[usable_columns].sort_values("Date").reset_index(drop=True)
    missing_after = data.isna().sum().astype(int).to_dict()
    if data.empty:
        raise ValueError("清洗后没有可用数据，请检查 Date 和价格字段。")

    report = DataQualityReport(
        rows_before=rows_before,
        rows_after=len(data),
        start_date=data["Date"].min().date().isoformat(),
        end_date=data["Date"].max().date().isoformat(),
        missing_before=missing_before,
        missing_after=missing_after,
        duplicate_dates_removed=duplicate_dates_removed,
        nonpositive_price_rows_removed=nonpositive_price_rows_removed,
        price_column=price_column,
        has_volume="Volume" in data.columns and data["Volume"].fillna(0).gt(0).any(),
    )
    return data, report


def _normalize_column_name(column: object) -> str:
    text = str(column).strip().replace("-", " ").replace(".", " ")
    lowered = " ".join(text.lower().split())
    return COLUMN_ALIASES.get(lowered, text.strip())


def _find_date_column(data: pd.DataFrame) -> str:
    for column in data.columns:
        if column == "Date" or str(column).strip().lower() in REQUIRED_DATE_CANDIDATES:
            return column
    raise ValueError("数据必须包含 Date 日期字段。")


def _choose_price_column(data: pd.DataFrame) -> str:
    for column in ["Adj Close", "Close", "NAV"]:
        if column in data.columns and data[column].notna().any():
            return column
    raise ValueError("数据必须包含 Adj Close、Close 或 NAV 价格字段之一。")
