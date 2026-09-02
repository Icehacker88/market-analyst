from __future__ import annotations

import re
from typing import Any

import requests

from app.schemas.api import Asset
from app.services.cache import DiskCache


CATALOG = [
    Asset(symbol="SPY", name="SPDR S&P 500 ETF Trust", asset_type="etf", exchange="NYSE Arca", currency="USD", data_source="yahoo"),
    Asset(symbol="QQQ", name="Invesco QQQ Trust", asset_type="etf", exchange="NASDAQ", currency="USD", data_source="yahoo"),
    Asset(symbol="AAPL", name="Apple Inc.", asset_type="stock", exchange="NASDAQ", currency="USD", data_source="yahoo"),
    Asset(symbol="NVDA", name="NVIDIA Corporation", asset_type="stock", exchange="NASDAQ", currency="USD", data_source="yahoo"),
    Asset(symbol="MSFT", name="Microsoft Corporation", asset_type="stock", exchange="NASDAQ", currency="USD", data_source="yahoo"),
    Asset(symbol="AMZN", name="Amazon.com, Inc.", asset_type="stock", exchange="NASDAQ", currency="USD", data_source="yahoo"),
    Asset(symbol="GOOGL", name="Alphabet Inc.", asset_type="stock", exchange="NASDAQ", currency="USD", data_source="yahoo"),
    Asset(symbol="^NDX", name="NASDAQ 100 Index", asset_type="index", exchange="NASDAQ", currency="USD", data_source="yahoo"),
    Asset(symbol="^VIX", name="CBOE Volatility Index", asset_type="index", exchange="CBOE", currency="USD", data_source="yahoo"),
    Asset(symbol="600519.SH", name="贵州茅台", asset_type="stock", exchange="SSE", currency="CNY", data_source="akshare"),
    Asset(symbol="000001.SZ", name="平安银行", asset_type="stock", exchange="SZSE", currency="CNY", data_source="akshare"),
    Asset(symbol="300965.SZ", name="恒宇信通", asset_type="stock", exchange="SZSE", currency="CNY", data_source="akshare"),
    Asset(symbol="016452.OF", name="华夏纳斯达克100ETF发起式联接(QDII)C", asset_type="fund", exchange="OTC", currency="CNY", data_source="akshare"),
]

ALIASES = {
    "yingweida": "NVDA",
    "英伟达": "NVDA",
    "nvidia": "NVDA",
    "pingguo": "AAPL",
    "苹果": "AAPL",
    "apple": "AAPL",
    "weiruan": "MSFT",
    "微软": "MSFT",
    "microsoft": "MSFT",
    "yamaxun": "AMZN",
    "亚马逊": "AMZN",
    "amazon": "AMZN",
    "guge": "GOOGL",
    "谷歌": "GOOGL",
    "google": "GOOGL",
    "alphabet": "GOOGL",
}
DIRECT_SYMBOL_PATTERN = re.compile(
    r"^(?:[A-Z]{1,5}|[A-Z]{1,4}\.[A-Z]|[A-Z0-9]{1,10}=X|\^[A-Z0-9]{1,10}|[A-Z0-9]{1,10}-[A-Z0-9]{1,10}|\d{6}(?:\.(?:SH|SZ|BJ|OF))?)$"
)


def alias_key(value: str) -> str:
    return re.sub(r"\s+", "", value.strip().lower())


class AssetService:
    def __init__(self, cache: DiskCache | None = None) -> None:
        self.cache = cache or DiskCache()

    def search(self, query: str, limit: int = 10) -> list[Asset]:
        normalized = query.strip()
        if not normalized:
            return []
        key = {"version": 2, "query": normalized.lower(), "limit": limit}
        cached = self.cache.get("search", key, 24 * 60 * 60)
        if cached is not None:
            return [Asset.model_validate(item) for item in cached]

        lowered = normalized.lower()
        results = [
            asset
            for asset in CATALOG
            if lowered in asset.symbol.lower() or lowered in asset.name.lower()
        ]
        alias_symbol = ALIASES.get(alias_key(normalized))
        if alias_symbol:
            results.insert(0, self.resolve(alias_symbol))
        if len(results) < limit:
            results.extend(self._search_yahoo(normalized))
        inferred = self.resolve(normalized)
        if DIRECT_SYMBOL_PATTERN.fullmatch(normalized.upper()) and inferred.symbol not in {asset.symbol for asset in results}:
            results.insert(0, inferred)
        deduped = list({asset.symbol: asset for asset in results}.values())[:limit]
        self.cache.set("search", key, [item.model_dump() for item in deduped])
        return deduped

    def resolve_many(self, symbols: list[str]) -> list[Asset]:
        resolved = [self.resolve(symbol) for symbol in symbols]
        return list({asset.symbol: asset for asset in resolved}.values())

    def resolve(self, symbol: str) -> Asset:
        normalized = ALIASES.get(alias_key(symbol), symbol.strip().upper())
        if normalized.isdigit() and len(normalized) == 6:
            normalized = f"{normalized}.{'SH' if normalized.startswith(('5', '6', '9')) else 'SZ'}"
        catalog_match = next((item for item in CATALOG if item.symbol == normalized), None)
        if catalog_match:
            return catalog_match
        if normalized.endswith(".OF"):
            return Asset(symbol=normalized, name=normalized, asset_type="fund", exchange="OTC", currency="CNY", data_source="akshare")
        if normalized.endswith((".SH", ".SZ", ".BJ")) or (normalized.isdigit() and len(normalized) == 6):
            exchange = "SSE" if normalized.endswith(".SH") or normalized.startswith(("5", "6", "9")) else "SZSE"
            return Asset(symbol=normalized, name=normalized, asset_type="stock", exchange=exchange, currency="CNY", data_source="akshare")
        if normalized.startswith("^"):
            return Asset(symbol=normalized, name=normalized, asset_type="index", exchange=None, currency="USD", data_source="yahoo")
        if normalized.endswith("=X"):
            return Asset(symbol=normalized, name=normalized, asset_type="currency", exchange="FX", currency=None, data_source="yahoo")
        return Asset(symbol=normalized, name=normalized, asset_type="market", exchange=None, currency="USD", data_source="yahoo")

    def _search_yahoo(self, query: str) -> list[Asset]:
        try:
            response = requests.get(
                "https://query1.finance.yahoo.com/v1/finance/search",
                params={"q": query, "quotesCount": 8, "newsCount": 0},
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=6,
            )
            response.raise_for_status()
            quotes: list[dict[str, Any]] = response.json().get("quotes", [])
        except Exception:
            return []
        results = []
        for quote in quotes:
            symbol = quote.get("symbol")
            if not symbol:
                continue
            quote_type = str(quote.get("quoteType", "market")).lower()
            asset_type = {
                "equity": "stock",
                "etf": "etf",
                "index": "index",
                "mutualfund": "fund",
                "currency": "currency",
            }.get(quote_type, "market")
            results.append(
                Asset(
                    symbol=symbol,
                    name=quote.get("longname") or quote.get("shortname") or symbol,
                    asset_type=asset_type,
                    exchange=quote.get("exchange"),
                    currency=quote.get("currency"),
                    data_source="yahoo",
                )
            )
        return results
