from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
from typing import Iterable
from urllib.parse import quote

import pandas as pd
import requests


YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
TUSHARE_API_URL = "https://api.tushare.pro"
SUPPORTED_DATA_SOURCES = {"yahoo", "tushare"}
SUPPORTED_ASSET_TYPES = {"market", "fund"}


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


def download_online_data(
    ticker: str,
    start: str = "2016-01-01",
    end: str | None = None,
    data_source: str = "yahoo",
    asset_type: str = "market",
) -> pd.DataFrame:
    source = data_source.strip().lower()
    kind = asset_type.strip().lower()
    if source not in SUPPORTED_DATA_SOURCES:
        raise DataLoadError(f"不支持的数据源：{data_source}")
    if kind not in SUPPORTED_ASSET_TYPES:
        raise DataLoadError(f"不支持的资产类型：{asset_type}")
    if source == "yahoo":
        if kind != "market":
            raise DataLoadError("Yahoo 数据源当前仅用于股票、ETF、指数等市场行情。")
        return download_yahoo_chart(ticker=ticker, start=start, end=end)
    if kind == "fund":
        return download_tushare_fund_nav(ts_code=ticker, start=start, end=end)
    return download_tushare_daily(ts_code=ticker, start=start, end=end)


def download_tushare_daily(
    ts_code: str,
    start: str = "2016-01-01",
    end: str | None = None,
    token: str | None = None,
) -> pd.DataFrame:
    payload = _tushare_request(
        api_name="daily",
        params={
            "ts_code": ts_code.upper(),
            "start_date": _tushare_date(start),
            "end_date": _tushare_date(end or datetime.now(timezone.utc)),
        },
        fields=["trade_date", "open", "high", "low", "close", "vol"],
        token=token,
    )
    return _tushare_frame(
        payload,
        {
            "trade_date": "Date",
            "open": "Open",
            "high": "High",
            "low": "Low",
            "close": "Close",
            "vol": "Volume",
        },
        ts_code,
    )


def download_tushare_fund_nav(
    ts_code: str,
    start: str = "2016-01-01",
    end: str | None = None,
    token: str | None = None,
) -> pd.DataFrame:
    payload = _tushare_request(
        api_name="fund_nav",
        params={
            "ts_code": ts_code.upper(),
            "start_date": _tushare_date(start),
            "end_date": _tushare_date(end or datetime.now(timezone.utc)),
        },
        fields=[
            "nav_date",
            "unit_nav",
            "accum_nav",
            "adj_nav",
            "net_asset",
            "total_netasset",
        ],
        token=token,
    )
    frame = _tushare_frame(
        payload,
        {
            "nav_date": "Date",
            "unit_nav": "Unit NAV",
            "accum_nav": "Accum NAV",
            "adj_nav": "NAV",
            "net_asset": "Net Asset",
            "total_netasset": "Total Net Asset",
        },
        ts_code,
    )
    if "NAV" not in frame or frame["NAV"].isna().all():
        for fallback in ["Accum NAV", "Unit NAV"]:
            if fallback in frame and frame[fallback].notna().any():
                frame["NAV"] = frame[fallback]
                break
    if "NAV" not in frame or frame["NAV"].isna().all():
        raise DataLoadError(f"Tushare Pro 返回的 {ts_code} 数据缺少可用净值。")
    return frame


def online_source_description(
    data_source: str,
    asset_type: str,
    start: str,
    end: str | None,
) -> str:
    source = data_source.strip().lower()
    kind = asset_type.strip().lower()
    if source == "tushare":
        label = "Tushare Pro fund_nav" if kind == "fund" else "Tushare Pro daily"
    else:
        label = "Yahoo Finance chart API"
    return f"{label} ({start} to {end or 'today'})"


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


def _tushare_request(
    api_name: str,
    params: dict[str, str],
    fields: list[str],
    token: str | None,
) -> dict[str, object]:
    resolved_token = token or os.getenv("TUSHARE_TOKEN")
    if not resolved_token:
        raise DataLoadError("未配置 TUSHARE_TOKEN，无法使用 Tushare Pro 数据源。")
    try:
        response = requests.post(
            TUSHARE_API_URL,
            json={
                "api_name": api_name,
                "token": resolved_token,
                "params": params,
                "fields": ",".join(fields),
            },
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception as exc:
        raise DataLoadError(f"Tushare Pro 请求失败：{exc}") from exc
    if payload.get("code") != 0:
        raise DataLoadError(f"Tushare Pro 返回错误：{payload.get('msg') or payload}")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise DataLoadError("Tushare Pro 没有返回可用数据。")
    return data


def _tushare_frame(
    payload: dict[str, object],
    rename: dict[str, str],
    code: str,
) -> pd.DataFrame:
    fields = payload.get("fields")
    items = payload.get("items")
    if not isinstance(fields, list) or not isinstance(items, list) or not items:
        raise DataLoadError(f"Tushare Pro 没有返回 {code} 的历史数据。")
    frame = pd.DataFrame(items, columns=fields).rename(columns=rename)
    if "Date" not in frame:
        raise DataLoadError(f"Tushare Pro 返回的 {code} 数据缺少日期字段。")
    frame["Date"] = pd.to_datetime(frame["Date"], format="%Y%m%d", errors="coerce")
    return frame.dropna(subset=["Date"]).sort_values("Date").reset_index(drop=True)


def _tushare_date(value: str | datetime) -> str:
    return _parse_date(value).strftime("%Y%m%d")
