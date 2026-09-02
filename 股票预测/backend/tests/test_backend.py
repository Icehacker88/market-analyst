from __future__ import annotations

import math
import threading
import time
from datetime import date

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from app.core.json_utils import safe_json
from app.main import app
from app.services.assets import AssetService
from app.services.cache import DiskCache
from app.services.ledger import LedgerService
from app.services.market import MarketService
from app.services.tasks import TaskManager


def synthetic_prices(rows: int = 180) -> pd.DataFrame:
    values = 100 * np.exp(np.linspace(0, 0.25, rows) + np.sin(np.arange(rows) / 8) * 0.01)
    return pd.DataFrame(
        {
            "Date": pd.date_range("2025-01-01", periods=rows, freq="B"),
            "Open": values,
            "High": values * 1.01,
            "Low": values * 0.99,
            "Close": values,
            "Adj Close": values,
            "Volume": np.full(rows, 1_000_000),
        }
    )


def test_asset_search_and_resolve(tmp_path) -> None:
    service = AssetService(DiskCache(tmp_path))
    results = service.search("SPY")
    assert results[0].symbol == "SPY"
    assert service.search("YINGWEIDA")[0].symbol == "NVDA"
    assert service.search("英伟达")[0].symbol == "NVDA"
    assert service.resolve_many(["YINGWEIDA", "英伟达", "NVDA"]) == [service.resolve("NVDA")]
    assert service.resolve("300965").symbol == "300965.SZ"
    assert service.resolve("016452.OF").asset_type == "fund"


def test_market_history_format_and_technical_indicators(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("app.services.market.download_online_data", lambda **_: synthetic_prices())
    service = MarketService(DiskCache(tmp_path))
    result = service.history("SPY", date(2025, 1, 1), None, "yahoo", "etf")
    assert result["records"]
    assert {"Date", "Price", "Daily_Return", "MA_20", "RSI_14"} <= set(result["records"][-1])
    assert result["data_as_of"]


def test_compare_keeps_working_when_one_asset_fails(monkeypatch, tmp_path) -> None:
    def loader(**kwargs):
        if kwargs["ticker"] == "BAD":
            raise RuntimeError("missing")
        return synthetic_prices()

    monkeypatch.setattr("app.services.market.download_online_data", loader)
    service = MarketService(DiskCache(tmp_path))
    result = service.compare(
        [
            {"symbol": "SPY", "data_source": "yahoo", "asset_type": "etf"},
            {"symbol": "BAD", "data_source": "yahoo", "asset_type": "market"},
        ],
        date(2025, 1, 1),
        None,
    )
    assert len(result["series"]) == 1
    assert result["errors"][0]["symbol"] == "BAD"


def test_ledger_unverified_rows_are_not_counted(monkeypatch) -> None:
    ledger = pd.DataFrame(
        [
            {"As_Of_Date": "2026-01-01", "Actual_1D_Return": 0.01, "Forecast_1D_Return": 0.005, "Actual_1D_Direction": "Up", "Raw_Direction_Correct": 1},
            {"As_Of_Date": "2026-01-02", "Actual_1D_Return": -0.01, "Forecast_1D_Return": 0.005, "Actual_1D_Direction": "Down", "Raw_Direction_Correct": 0},
            {"As_Of_Date": "2026-01-03", "Actual_1D_Return": math.nan, "Forecast_1D_Return": 0.005, "Actual_1D_Direction": None, "Raw_Direction_Correct": math.nan},
        ]
    )
    stats = LedgerService().statistics(ledger)
    all_stats = next(item for item in stats if item["window"] == "All")
    assert all_stats["completed"] == 2
    assert all_stats["pending"] == 1
    assert all_stats["direction_accuracy"] == 50
    assert all_stats["majority_baseline_accuracy"] == 50


def test_safe_json_removes_nan_and_infinity() -> None:
    result = safe_json({"nan": float("nan"), "inf": float("inf"), "ok": 1.0})
    assert result == {"nan": None, "inf": None, "ok": 1.0}


def test_task_manager_prevents_duplicate_training() -> None:
    gate = threading.Event()

    def runner(*_) -> str:
        gate.wait(1)
        return "done"

    manager = TaskManager(runner=runner)
    first = manager.submit("SPY", "yahoo", "market", "2020-01-01", False)
    second = manager.submit("SPY", "yahoo", "market", "2020-01-01", False)
    assert first["task_id"] == second["task_id"]
    gate.set()
    time.sleep(0.05)
    assert manager.get(first["task_id"])["status"] == "completed"


def test_api_limits_assets_to_three_and_returns_structured_error() -> None:
    client = TestClient(app)
    response = client.post("/api/assets/resolve", json={"symbols": ["AAPL", "SPY", "QQQ", "NVDA"]})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
