from __future__ import annotations

import re
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


SYMBOL_PATTERN = re.compile(r"^[A-Za-z0-9.^=_-]{1,24}$")
DataSource = Literal["yahoo", "akshare"]
AssetType = Literal["stock", "etf", "index", "fund", "currency", "market"]


class Asset(BaseModel):
    symbol: str
    name: str
    asset_type: AssetType
    exchange: str | None = None
    currency: str | None = None
    data_source: DataSource

    @field_validator("symbol")
    @classmethod
    def valid_symbol(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not SYMBOL_PATTERN.fullmatch(normalized):
            raise ValueError("symbol contains unsupported characters")
        return normalized


class ResolveRequest(BaseModel):
    symbols: list[str] = Field(min_length=1, max_length=3)

    @field_validator("symbols")
    @classmethod
    def valid_symbols(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().upper() for value in values]
        if len(set(normalized)) != len(normalized):
            raise ValueError("duplicate symbols are not allowed")
        for symbol in normalized:
            if not SYMBOL_PATTERN.fullmatch(symbol):
                raise ValueError(f"invalid symbol: {symbol}")
        return normalized


class AssetInput(BaseModel):
    symbol: str
    data_source: DataSource = "yahoo"
    asset_type: AssetType = "market"

    @field_validator("symbol")
    @classmethod
    def valid_symbol(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not SYMBOL_PATTERN.fullmatch(normalized):
            raise ValueError("invalid symbol")
        return normalized


class CompareRequest(BaseModel):
    assets: list[AssetInput] = Field(min_length=1, max_length=3)
    start: date
    end: date | None = None

    @model_validator(mode="after")
    def valid_range(self) -> "CompareRequest":
        if self.end and self.start > self.end:
            raise ValueError("start must be before end")
        symbols = [asset.symbol for asset in self.assets]
        if len(symbols) != len(set(symbols)):
            raise ValueError("duplicate symbols are not allowed")
        return self


class ForecastRunRequest(AssetInput):
    start: date = date(2016, 1, 1)
    include_arima: bool = True


class HealthResponse(BaseModel):
    status: str
    yahoo_finance: str
    akshare: str
    last_updated: str | None


class SearchResponse(BaseModel):
    query: str
    results: list[Asset]


class ResolveResponse(BaseModel):
    assets: list[Asset]


class DataResponse(BaseModel):
    data: Any


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Any | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail
