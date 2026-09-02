from __future__ import annotations

import importlib.util
from datetime import date

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import cors_origins
from app.core.json_utils import safe_json
from app.schemas.api import (
    CompareRequest,
    DataResponse,
    ErrorDetail,
    ErrorResponse,
    ForecastRunRequest,
    HealthResponse,
    ResolveRequest,
    ResolveResponse,
    SearchResponse,
)
from app.services.assets import AssetService
from app.services.cache import DiskCache
from app.services.ledger import LedgerService
from app.services.market import MarketService
from app.services.outputs import ForecastNotFoundError, OutputService
from app.services.tasks import TaskManager
from src.data_loader import DataLoadError


cache = DiskCache()
assets = AssetService(cache)
market = MarketService(cache)
ledger = LedgerService()
outputs = OutputService(ledger)
tasks = TaskManager()

app = FastAPI(
    title="Orivane API",
    version="1.0.0",
    description="Real market data, model forecasts, and frozen prediction history.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    return _error(422, "validation_error", "请求参数无效。", exc.errors())


@app.exception_handler(DataLoadError)
async def data_error(_: Request, exc: DataLoadError) -> JSONResponse:
    return _error(502, "data_source_error", str(exc))


@app.exception_handler(ForecastNotFoundError)
async def forecast_error(_: Request, exc: ForecastNotFoundError) -> JSONResponse:
    return _error(404, "forecast_not_found", str(exc))


@app.exception_handler(Exception)
async def unexpected_error(_: Request, exc: Exception) -> JSONResponse:
    return _error(500, "internal_error", str(exc))


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        yahoo_finance="available",
        akshare="available" if importlib.util.find_spec("akshare") else "not_installed",
        last_updated=cache.last_updated(),
    )


@app.get("/api/assets/search", response_model=SearchResponse)
def search_assets(q: str = Query(min_length=1, max_length=80)) -> SearchResponse:
    return SearchResponse(query=q, results=assets.search(q))


@app.post("/api/assets/resolve", response_model=ResolveResponse)
def resolve_assets(body: ResolveRequest) -> ResolveResponse:
    return ResolveResponse(assets=assets.resolve_many(body.symbols))


@app.get("/api/market/history", response_model=DataResponse)
def market_history(
    symbol: str = Query(min_length=1, max_length=24),
    start: date = Query(default=date(2025, 1, 1)),
    end: date | None = None,
    interval: str = Query(default="1d", pattern="^1d$"),
    data_source: str = Query(default="yahoo", pattern="^(yahoo|akshare)$"),
    asset_type: str = Query(default="market", pattern="^(stock|etf|index|fund|currency|market)$"),
) -> DataResponse:
    _ = interval
    if end and start > end:
        raise HTTPException(422, "start must be before end")
    return DataResponse(data=market.history(symbol.upper(), start, end, data_source, asset_type))


@app.post("/api/compare", response_model=DataResponse)
def compare_assets(body: CompareRequest) -> DataResponse:
    return DataResponse(
        data=market.compare(
            [asset.model_dump() for asset in body.assets],
            body.start,
            body.end,
        )
    )


@app.get("/api/forecast/latest", response_model=DataResponse)
def latest_forecast(symbol: str = Query(min_length=1, max_length=24)) -> DataResponse:
    return DataResponse(data=outputs.latest_forecast(symbol.upper()))


@app.post("/api/forecast/run", response_model=DataResponse)
def run_forecast(body: ForecastRunRequest) -> DataResponse:
    return DataResponse(
        data=tasks.submit(
            body.symbol,
            body.data_source,
            body.asset_type,
            body.start.isoformat(),
            body.include_arima,
        )
    )


@app.get("/api/forecast/status/{task_id}", response_model=DataResponse)
def forecast_status(task_id: str) -> DataResponse:
    task = tasks.get(task_id)
    if not task:
        raise HTTPException(404, "task not found")
    return DataResponse(data=task)


@app.get("/api/performance/{symbol}", response_model=DataResponse)
def model_performance(symbol: str) -> DataResponse:
    return DataResponse(data=outputs.performance(symbol.upper()))


@app.get("/api/predictions/history/{symbol}", response_model=DataResponse)
def prediction_history(symbol: str) -> DataResponse:
    return DataResponse(data=ledger.history(symbol.upper()))


def _error(status: int, code: str, message: str, details: object | None = None) -> JSONResponse:
    body = ErrorResponse(error=ErrorDetail(code=code, message=message, details=safe_json(details)))
    return JSONResponse(status_code=status, content=body.model_dump())
