from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.data_loader import safe_ticker_for_path  # noqa: E402
from src.models import actionable_signal, classify_signal_quality  # noqa: E402
from src.prediction_ledger import LEDGER_COLUMNS  # noqa: E402


def safe(value: Any) -> Any:
    if value is None or value is pd.NA:
        return None
    if isinstance(value, dict):
        return {str(key): safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [safe(item) for item in value]
    if hasattr(value, "item"):
        return safe(value.item())
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    try:
        return None if pd.isna(value) else value
    except (TypeError, ValueError):
        return value


def latest_run(symbol: str) -> Path | None:
    root = ROOT / "outputs" / safe_ticker_for_path(symbol)
    runs = sorted(path for path in root.glob("*") if path.is_dir()) if root.exists() else []
    valid = [path for path in runs if (path / "model_comparison.csv").exists() and (path / "forecast_1d_5d.csv").exists()]
    return valid[-1] if valid else None


def clamp(value: float, minimum: float = 0.0, maximum: float = 100.0) -> float:
    return max(minimum, min(maximum, value))


def confidence_score(best: pd.Series) -> int:
    cv_edge = pd.to_numeric(pd.Series([best.get("CV_Directional_Edge")]), errors="coerce").iloc[0]
    cv_balanced = pd.to_numeric(pd.Series([best.get("CV_Balanced_Accuracy")]), errors="coerce").iloc[0]
    quality = classify_signal_quality(best)
    score = 45.0
    if not pd.isna(cv_edge):
        score += min(20.0, float(cv_edge) * 1.2) if cv_edge > 0 else -min(14.0, abs(float(cv_edge)) * 0.8)
    if not pd.isna(cv_balanced):
        score += 8.0 if cv_balanced >= 55 else 3.0 if cv_balanced >= 50 else -8.0
    score += 12.0 if quality == "High" else 6.0 if quality == "Medium" else -5.0
    return int(round(clamp(score)))


def forecast(symbol: str, run: Path) -> dict[str, Any]:
    metrics = pd.read_csv(run / "model_comparison.csv")
    forecast_frame = pd.read_csv(run / "forecast_1d_5d.csv")
    cleaned = pd.read_csv(run / "cleaned_prices.csv")
    best = metrics.iloc[0]
    first = forecast_frame.iloc[0]
    last = forecast_frame.iloc[-1]
    latest_price = float(cleaned["Price"].iloc[-1])
    quality = classify_signal_quality(best)
    risk_path = run / "risk_forecast_5d.csv"
    risk = pd.read_csv(risk_path).iloc[0].to_dict() if risk_path.exists() else None
    return safe(
        {
            "symbol": symbol,
            "best_model": best["Model"],
            "signal": actionable_signal(first["Predicted_Direction"], quality),
            "signal_quality": quality,
            "forecast_1d_return": first["Predicted_Return"],
            "forecast_1d_price": first["Predicted_Price"],
            "forecast_1d_direction": first["Predicted_Direction"],
            "forecast_5d_return": float(last["Predicted_Price"]) / latest_price - 1,
            "forecast_5d_price": last["Predicted_Price"],
            "forecast_days": forecast_frame.to_dict("records"),
            "risk": risk,
            "generated_at": run.name,
            "data_as_of": str(cleaned["Date"].iloc[-1]),
            "validation_sample_size": len(pd.read_csv(run / "best_model_predictions.csv")),
            "beats_majority_baseline": (
                None
                if "CV_Directional_Edge" not in best or pd.isna(best.get("CV_Directional_Edge"))
                else bool(float(best["CV_Directional_Edge"]) > 0)
            ),
            "confidence_score": confidence_score(best),
            "explanation": [
                f"Latest published model: {best['Model']}.",
                f"Expected next-period return: {float(first['Predicted_Return']):+.2%}.",
                "Public deployment displays the latest frozen Python model output.",
            ],
        }
    )


def performance(symbol: str, run: Path, live_stats: list[dict[str, Any]]) -> dict[str, Any]:
    metrics = pd.read_csv(run / "model_comparison.csv")
    predictions = pd.read_csv(run / "best_model_predictions.csv")
    return safe(
        {
            "symbol": symbol,
            "best_model": metrics.iloc[0]["Model"],
            "backtest": {
                "best": metrics.iloc[0].to_dict(),
                "models": metrics.to_dict("records"),
                "test_samples": len(predictions),
                "evaluation_start": predictions["Date"].min() if "Date" in predictions else None,
                "evaluation_end": predictions["Date"].max() if "Date" in predictions else None,
            },
            "live_predictions": {
                "statistics": live_stats,
                "notice": "Historical accuracy uses completed frozen predictions only.",
            },
        }
    )


def ledger_history(symbol: str, ledger: pd.DataFrame) -> dict[str, Any]:
    scope = ledger[ledger["Ticker"].astype(str).str.upper() == symbol].copy()
    scope = scope.sort_values(["As_Of_Date", "Created_At"], ascending=False)
    completed_all = scope.dropna(subset=["Actual_1D_Return", "Raw_Direction_Correct"]).sort_values("As_Of_Date")
    stats = []
    for window in [20, 60, 120, None]:
        completed = completed_all if window is None else completed_all.tail(window)
        actual_direction = completed["Actual_1D_Direction"].dropna()
        up_rate = float((actual_direction == "Up").mean() * 100) if len(actual_direction) else math.nan
        baseline = max(up_rate, 100 - up_rate) if len(actual_direction) else math.nan
        accuracy = float(completed["Raw_Direction_Correct"].astype(float).mean() * 100) if len(completed) else math.nan
        forecast_values = pd.to_numeric(completed["Forecast_1D_Return"], errors="coerce")
        actual_values = pd.to_numeric(completed["Actual_1D_Return"], errors="coerce")
        errors = (actual_values - forecast_values).dropna().abs()
        stats.append(
            {
                "window": "All" if window is None else str(window),
                "completed": len(completed),
                "pending": int(scope["Actual_1D_Return"].isna().sum()),
                "direction_accuracy": accuracy,
                "majority_baseline_accuracy": baseline,
                "direction_edge": accuracy - baseline if len(completed) else math.nan,
                "mean_absolute_return_error": float(errors.mean()) if len(errors) else math.nan,
                "median_absolute_return_error": float(errors.median()) if len(errors) else math.nan,
                "hit_count": int((completed["Raw_Direction_Correct"] == 1).sum()),
                "miss_count": int((completed["Raw_Direction_Correct"] == 0).sum()),
            }
        )
    records = []
    for _, row in scope.iterrows():
        item = row.to_dict()
        forecast_return = pd.to_numeric(pd.Series([row.get("Forecast_1D_Return")]), errors="coerce").iloc[0]
        actual_return = pd.to_numeric(pd.Series([row.get("Actual_1D_Return")]), errors="coerce").iloc[0]
        item["Verified"] = not pd.isna(actual_return)
        item["Absolute_Return_Error"] = (
            abs(float(actual_return) - float(forecast_return))
            if not pd.isna(actual_return) and not pd.isna(forecast_return)
            else None
        )
        records.append(item)
    rolling = completed_all.copy()
    rolling["Rolling_Accuracy_20"] = pd.to_numeric(rolling["Raw_Direction_Correct"], errors="coerce").rolling(20, min_periods=1).mean() * 100
    rolling["Cumulative_Accuracy"] = pd.to_numeric(rolling["Raw_Direction_Correct"], errors="coerce").expanding().mean() * 100
    return safe(
        {
            "symbol": symbol,
            "notice": "Historical accuracy uses completed frozen predictions only.",
            "statistics": stats,
            "records": records,
            "charts": {
                "rolling_accuracy": rolling[["As_Of_Date", "Rolling_Accuracy_20", "Cumulative_Accuracy"]].to_dict("records"),
                "scatter": [],
                "timeline": [],
                "errors": [],
            },
        }
    )


def main() -> None:
    ledger_path = ROOT / "data" / "history" / "prediction_ledger.csv"
    ledger = pd.read_csv(ledger_path) if ledger_path.exists() else pd.DataFrame(columns=LEDGER_COLUMNS)
    for column in LEDGER_COLUMNS:
        if column not in ledger:
            ledger[column] = pd.NA
    symbols = sorted(
        {
            path.name
            for path in (ROOT / "outputs").iterdir()
            if path.is_dir() and path.name != "daily_reports"
        }
        | set(ledger["Ticker"].dropna().astype(str))
    )
    payload: dict[str, Any] = {"forecasts": {}, "performance": {}, "history": {}}
    for symbol in symbols:
        history = ledger_history(symbol, ledger)
        payload["history"][symbol] = history
        run = latest_run(symbol)
        if run:
            payload["forecasts"][symbol] = forecast(symbol, run)
            payload["performance"][symbol] = performance(symbol, run, history["statistics"])
    target = ROOT / "frontend" / "netlify" / "functions" / "data" / "public-data.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(safe(payload), ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {target}")


if __name__ == "__main__":
    main()
