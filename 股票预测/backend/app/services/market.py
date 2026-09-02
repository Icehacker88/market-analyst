from __future__ import annotations

from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from app.core.json_utils import safe_json
from app.services.cache import DiskCache
from src.data_loader import download_online_data, online_source_description
from src.features import build_technical_indicators
from src.market_analyst import analyze_market_frame
from src.preprocessing import clean_price_data


HISTORY_COLUMNS = [
    "Date", "Open", "High", "Low", "Close", "Adj Close", "NAV", "Volume", "Price",
    "Daily_Return", "Weekly_Return", "Cumulative_Return", "MA_5", "MA_20", "MA_50",
    "RSI_14", "MACD", "MACD_Signal", "MACD_Hist", "BB_Middle", "BB_Upper",
    "BB_Lower", "Rolling_Std_20",
]


class MarketService:
    def __init__(self, cache: DiskCache | None = None) -> None:
        self.cache = cache or DiskCache()

    def history(
        self,
        symbol: str,
        start: date,
        end: date | None,
        data_source: str,
        asset_type: str,
    ) -> dict[str, Any]:
        source_asset_type = "fund" if asset_type == "fund" else "market"
        key = {
            "symbol": symbol,
            "start": start.isoformat(),
            "end": end.isoformat() if end else None,
            "data_source": data_source,
            "asset_type": source_asset_type,
        }
        cached = self.cache.get("history", key, 4 * 60 * 60)
        if cached is not None:
            return cached
        raw = download_online_data(
            ticker=symbol,
            start=start.isoformat(),
            end=end.isoformat() if end else None,
            data_source=data_source,
            asset_type=source_asset_type,
        )
        cleaned, quality = clean_price_data(raw)
        technical = build_technical_indicators(cleaned).replace([np.inf, -np.inf], np.nan)
        first_price = float(technical["Price"].dropna().iloc[0])
        technical["Cumulative_Return"] = technical["Price"] / first_price - 1
        snapshot, _ = analyze_market_frame(symbol, raw)
        columns = [column for column in HISTORY_COLUMNS if column in technical.columns]
        records = technical[columns].to_dict(orient="records")
        result = {
            "symbol": symbol,
            "data_source": data_source,
            "source_description": online_source_description(
                data_source,
                source_asset_type,
                start.isoformat(),
                end.isoformat() if end else None,
            ),
            "data_as_of": quality.end_date,
            "quality": quality.__dict__,
            "snapshot": snapshot.__dict__,
            "records": records,
        }
        sanitized = safe_json(result)
        self.cache.set("history", key, sanitized)
        return sanitized

    def compare(self, assets: list[dict[str, str]], start: date, end: date | None) -> dict[str, Any]:
        series = []
        errors = []
        for asset in assets:
            try:
                history = self.history(
                    symbol=asset["symbol"],
                    start=start,
                    end=end,
                    data_source=asset["data_source"],
                    asset_type=asset["asset_type"],
                )
                points = [
                    {
                        "date": row["Date"],
                        "price": row["Price"],
                        "normalized": row["Price"] / history["records"][0]["Price"] * 100,
                    }
                    for row in history["records"]
                    if row.get("Price") is not None
                ]
                series.append(
                    {
                        "symbol": asset["symbol"],
                        "data_as_of": history["data_as_of"],
                        "data_source": asset["data_source"],
                        "points": points,
                    }
                )
            except Exception as exc:
                errors.append({"symbol": asset["symbol"], "message": str(exc)})
        return safe_json({"series": series, "errors": errors})
