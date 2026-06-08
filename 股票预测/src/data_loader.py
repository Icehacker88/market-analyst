from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import quote

import pandas as pd
import requests


YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"


class DataLoadError(RuntimeError):
    """Raised when price data cannot be loaded or parsed."""


def load_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise DataLoadError(f"找不到 CSV 文件：{path}")
    try:
        return pd.read_csv(path)
    except Exception as exc:  # pragma: no cover - message matters more than type
        raise DataLoadError(f"读取 CSV 失败：{path}，原因：{exc}") from exc


def download_yahoo_chart(
    ticker: str,
    start: str = "2016-01-01",
    end: str | None = None,
) -> pd.DataFrame:
    start_dt = _parse_date(start)
    end_dt = _parse_date(end) if end else datetime.now(timezone.utc)
    # Yahoo period2 is exclusive, so add one day to include the requested end date.
    period1 = int(start_dt.timestamp())
    period2 = int((end_dt + timedelta(days=1)).timestamp())

    params = {
        "period1": period1,
        "period2": period2,
        "interval": "1d",
        "events": "history",
        "includeAdjustedClose": "true",
    }
    url = YAHOO_CHART_URL.format(ticker=quote(ticker.upper(), safe=""))
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        response = requests.get(url, params=params, headers=headers, timeout=30)
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        raise DataLoadError(f"在线下载 {ticker} 数据失败：{exc}") from exc

    result = payload.get("chart", {}).get("result")
    error = payload.get("chart", {}).get("error")
    if error:
        raise DataLoadError(f"Yahoo 返回错误：{error}")
    if not result:
        raise DataLoadError(f"Yahoo 没有返回 {ticker} 的历史数据")

    data = result[0]
    timestamps = data.get("timestamp") or []
    quote_data = (data.get("indicators", {}).get("quote") or [{}])[0]
    adjclose = (
        (data.get("indicators", {}).get("adjclose") or [{}])[0].get("adjclose")
    )
    if not timestamps:
        raise DataLoadError(f"{ticker} 没有可用的日线记录")

    frame = pd.DataFrame(
        {
            "Date": pd.to_datetime(timestamps, unit="s", utc=True)
            .tz_convert(None)
            .date,
            "Open": quote_data.get("open"),
            "High": quote_data.get("high"),
            "Low": quote_data.get("low"),
            "Close": quote_data.get("close"),
            "Adj Close": adjclose,
            "Volume": quote_data.get("volume"),
        }
    )
    return frame


def infer_ticker_from_path(path: Path) -> str:
    return path.stem.upper().replace(" ", "_")


def safe_ticker_for_path(ticker: str) -> str:
    return (
        ticker.upper()
        .replace("^", "")
        .replace("=", "_")
        .replace("/", "_")
        .replace("\\", "_")
        .replace(" ", "_")
    )


def choose_sources(input_path: Path | None, tickers: Iterable[str] | None) -> list[str]:
    if input_path:
        return [str(input_path)]
    return [ticker.upper() for ticker in tickers or []]


def _parse_date(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc)
    parsed = pd.to_datetime(value, errors="coerce", utc=True)
    if pd.isna(parsed):
        raise DataLoadError(f"日期格式无法识别：{value}")
    return parsed.to_pydatetime()
