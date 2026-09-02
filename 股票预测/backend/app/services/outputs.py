from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.core.config import OUTPUTS_ROOT
from app.core.json_utils import safe_json
from app.services.ledger import LedgerService
from src.data_loader import safe_ticker_for_path
from src.features import build_technical_indicators
from src.models import actionable_signal, classify_signal_quality


class ForecastNotFoundError(FileNotFoundError):
    pass


class OutputService:
    def __init__(self, ledger: LedgerService | None = None) -> None:
        self.ledger = ledger or LedgerService()

    def latest_forecast(self, symbol: str) -> dict[str, Any]:
        run_dir = self.latest_run(symbol)
        metrics = pd.read_csv(run_dir / "model_comparison.csv")
        forecast = pd.read_csv(run_dir / "forecast_1d_5d.csv")
        cleaned = pd.read_csv(run_dir / "cleaned_prices.csv")
        best = metrics.iloc[0]
        first = forecast.iloc[0]
        last = forecast.iloc[-1]
        latest_price = float(cleaned["Price"].iloc[-1])
        quality = classify_signal_quality(best)
        risk = _read_first(run_dir / "risk_forecast_5d.csv")
        result = {
            "symbol": symbol,
            "best_model": best.get("Model"),
            "signal": actionable_signal(first.get("Predicted_Direction"), quality),
            "signal_quality": quality,
            "forecast_1d_return": first.get("Predicted_Return"),
            "forecast_1d_price": first.get("Predicted_Price"),
            "forecast_1d_direction": first.get("Predicted_Direction"),
            "forecast_5d_return": float(last["Predicted_Price"]) / latest_price - 1,
            "forecast_5d_price": last.get("Predicted_Price"),
            "forecast_days": forecast.to_dict("records"),
            "risk": risk,
            "generated_at": self.generated_at(run_dir),
            "data_as_of": str(cleaned["Date"].iloc[-1]),
            "validation_sample_size": len(pd.read_csv(run_dir / "best_model_predictions.csv")),
            "beats_majority_baseline": _beats_baseline(best),
            "explanation": self._explanation(cleaned, best, first, quality),
        }
        return safe_json(result)

    def performance(self, symbol: str) -> dict[str, Any]:
        run_dir = self.latest_run(symbol)
        metrics = pd.read_csv(run_dir / "model_comparison.csv")
        best_predictions = pd.read_csv(run_dir / "best_model_predictions.csv")
        risk_metrics = _read_frame(run_dir / "risk_model_comparison.csv")
        ledger_history = self.ledger.history(symbol)
        best = metrics.iloc[0].to_dict()
        return safe_json(
            {
                "symbol": symbol,
                "best_model": best.get("Model"),
                "backtest": {
                    "best": best,
                    "models": metrics.to_dict("records"),
                    "test_samples": len(best_predictions),
                    "evaluation_start": best_predictions["Date"].min() if "Date" in best_predictions else None,
                    "evaluation_end": best_predictions["Date"].max() if "Date" in best_predictions else None,
                    "risk_models": risk_metrics,
                },
                "live_predictions": {
                    "statistics": ledger_history["statistics"],
                    "notice": ledger_history["notice"],
                },
                "generated_at": self.generated_at(run_dir),
            }
        )

    def latest_run(self, symbol: str) -> Path:
        root = OUTPUTS_ROOT / safe_ticker_for_path(symbol)
        runs = sorted(path for path in root.glob("*") if path.is_dir()) if root.exists() else []
        valid = [path for path in runs if (path / "model_comparison.csv").exists() and (path / "forecast_1d_5d.csv").exists()]
        if not valid:
            raise ForecastNotFoundError(f"{symbol} 暂无已生成预测，请点击重新分析。")
        return valid[-1]

    def generated_at(self, run_dir: Path) -> str:
        try:
            return datetime.strptime(run_dir.name, "%Y%m%d_%H%M%S").isoformat()
        except ValueError:
            return datetime.fromtimestamp(run_dir.stat().st_mtime).isoformat()

    def _explanation(self, cleaned: pd.DataFrame, best: pd.Series, first: pd.Series, quality: str) -> list[str]:
        technical = build_technical_indicators(cleaned).replace([np.inf, -np.inf], np.nan).iloc[-1]
        lines = []
        if pd.notna(technical.get("MA_20")):
            relation = "上方" if technical["Price"] >= technical["MA_20"] else "下方"
            lines.append(f"价格目前位于 MA20 {relation}。")
        if pd.notna(technical.get("RSI_14")):
            rsi = float(technical["RSI_14"])
            state = "接近超买区域" if rsi >= 70 else "接近超卖区域" if rsi <= 30 else "处于中性区域"
            lines.append(f"RSI14 为 {rsi:.1f}，{state}。")
        lines.append(f"模型预计下一交易日收益为 {float(first['Predicted_Return']):+.2%}。")
        cv_edge = best.get("CV_Directional_Edge")
        if pd.notna(cv_edge):
            lines.append(f"滚动验证方向优势为 {float(cv_edge):+.1f} 个百分点。")
        if quality == "Low":
            lines.append("当前信号为 Observe，因为滚动验证优势不足或历史输出缺少该验证指标。")
        return lines


def _read_first(path: Path) -> dict[str, Any] | None:
    frame = _read_frame(path)
    return frame[0] if frame else None


def _read_frame(path: Path) -> list[dict[str, Any]]:
    return pd.read_csv(path).to_dict("records") if path.exists() else []


def _beats_baseline(best: pd.Series) -> bool | None:
    edge = best.get("CV_Directional_Edge")
    return None if pd.isna(edge) else bool(float(edge) > 0)
