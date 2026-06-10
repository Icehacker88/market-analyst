from __future__ import annotations

from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from src.preprocessing import clean_price_data


LEDGER_COLUMNS = [
    "Created_At",
    "As_Of_Date",
    "Ticker",
    "Best_Model",
    "Raw_Direction",
    "Action_Signal",
    "Signal_Quality",
    "Forecast_1D_Return",
    "Risk_5D_Model",
    "Risk_5D_Probability",
    "Risk_5D_Status",
    "Risk_5D_Threshold_Daily_Vol",
    "Actual_1D_Date",
    "Actual_1D_Return",
    "Actual_1D_Direction",
    "Raw_Direction_Correct",
    "Action_Signal_Correct",
    "Actual_5D_Date",
    "Actual_5D_Realized_Vol",
    "Actual_5D_High_Risk",
    "Risk_5D_Correct",
]
TEXT_COLUMNS = [
    "Created_At",
    "As_Of_Date",
    "Ticker",
    "Best_Model",
    "Raw_Direction",
    "Action_Signal",
    "Signal_Quality",
    "Risk_5D_Model",
    "Risk_5D_Status",
    "Actual_1D_Date",
    "Actual_1D_Direction",
    "Actual_5D_Date",
]


def update_prediction_ledger(
    ledger_path: Path,
    prediction_frame: pd.DataFrame,
    market_frames: dict[str, pd.DataFrame],
    generated_at: datetime,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    ledger = _load_ledger(ledger_path)
    ledger = _reconcile_actuals(ledger, market_frames)
    existing_keys = set(zip(ledger["Ticker"], ledger["As_Of_Date"]))
    new_rows = []
    for _, prediction in prediction_frame.iterrows():
        ticker = str(prediction.get("Ticker", ""))
        if prediction.get("Error") or ticker not in market_frames:
            continue
        cleaned, _ = clean_price_data(market_frames[ticker])
        as_of_date = pd.to_datetime(cleaned["Date"].iloc[-1]).date().isoformat()
        if (ticker, as_of_date) in existing_keys:
            continue
        new_rows.append(_new_ledger_row(prediction, generated_at, as_of_date))
    if new_rows:
        new_frame = pd.DataFrame(new_rows).reindex(columns=LEDGER_COLUMNS)
        ledger = (
            new_frame
            if ledger.empty
            else pd.concat([ledger, new_frame], ignore_index=True)
        )
    ledger = ledger.reindex(columns=LEDGER_COLUMNS).sort_values(
        ["As_Of_Date", "Ticker"]
    )
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    ledger.to_csv(ledger_path, index=False)
    return ledger.reset_index(drop=True), build_ledger_metrics(ledger)


def build_ledger_metrics(ledger: pd.DataFrame) -> pd.DataFrame:
    rows = []
    scopes = [("ALL", ledger)] + [
        (ticker, group) for ticker, group in ledger.groupby("Ticker", sort=True)
    ]
    for ticker, scope in scopes:
        ordered = scope.sort_values("As_Of_Date")
        for window in [20, 60, 120, None]:
            sample = ordered if window is None else ordered.tail(window)
            direction = sample.dropna(subset=["Raw_Direction_Correct"])
            actionable = sample.dropna(subset=["Action_Signal_Correct"])
            risk = sample.dropna(subset=["Risk_5D_Correct"])
            rows.append(
                {
                    "Ticker": ticker,
                    "Window": "All" if window is None else str(window),
                    "Completed_1D": len(direction),
                    "Raw_Direction_Accuracy": _mean_percent(
                        direction["Raw_Direction_Correct"]
                    ),
                    "Actionable_1D": len(actionable),
                    "Actionable_Accuracy": _mean_percent(
                        actionable["Action_Signal_Correct"]
                    ),
                    "Actionable_Coverage": (
                        float(len(actionable) / len(direction) * 100)
                        if len(direction)
                        else np.nan
                    ),
                    "Completed_Risk_5D": len(risk),
                    "Risk_5D_Accuracy": _mean_percent(risk["Risk_5D_Correct"]),
                }
            )
    return pd.DataFrame(rows)


def _load_ledger(path: Path) -> pd.DataFrame:
    if path.exists() and path.stat().st_size:
        ledger = pd.read_csv(path)
    else:
        ledger = pd.DataFrame(columns=LEDGER_COLUMNS)
    for column in LEDGER_COLUMNS:
        if column not in ledger.columns:
            ledger[column] = pd.NA
    for column in TEXT_COLUMNS:
        ledger[column] = ledger[column].astype("object")
    return ledger.reindex(columns=LEDGER_COLUMNS)


def _reconcile_actuals(
    ledger: pd.DataFrame,
    market_frames: dict[str, pd.DataFrame],
) -> pd.DataFrame:
    result = ledger.copy()
    for ticker, raw in market_frames.items():
        cleaned, _ = clean_price_data(raw)
        cleaned["Date"] = pd.to_datetime(cleaned["Date"])
        ticker_rows = result.index[result["Ticker"] == ticker]
        for index in ticker_rows:
            as_of = pd.to_datetime(result.at[index, "As_Of_Date"])
            history = cleaned[cleaned["Date"] <= as_of]
            future = cleaned[cleaned["Date"] > as_of]
            if history.empty:
                continue
            current_price = float(history["Price"].iloc[-1])
            if pd.isna(result.at[index, "Actual_1D_Return"]) and len(future) >= 1:
                next_row = future.iloc[0]
                actual_return = float(np.log(float(next_row["Price"]) / current_price))
                actual_direction = "Up" if actual_return >= 0 else "Down"
                result.at[index, "Actual_1D_Date"] = next_row["Date"].date().isoformat()
                result.at[index, "Actual_1D_Return"] = actual_return
                result.at[index, "Actual_1D_Direction"] = actual_direction
                result.at[index, "Raw_Direction_Correct"] = int(
                    result.at[index, "Raw_Direction"] == actual_direction
                )
                signal = result.at[index, "Action_Signal"]
                if signal in {"Up", "Down"}:
                    result.at[index, "Action_Signal_Correct"] = int(
                        signal == actual_direction
                    )
            if pd.isna(result.at[index, "Actual_5D_Realized_Vol"]) and len(future) >= 5:
                first_five = future.iloc[:5]
                prices = np.array([current_price, *first_five["Price"].astype(float)])
                realized_vol = float(np.sqrt(np.mean(np.diff(np.log(prices)) ** 2)))
                threshold = _to_float(
                    result.at[index, "Risk_5D_Threshold_Daily_Vol"]
                )
                if threshold is None:
                    continue
                actual_high_risk = int(realized_vol > threshold)
                probability = _to_float(result.at[index, "Risk_5D_Probability"])
                result.at[index, "Actual_5D_Date"] = (
                    first_five.iloc[-1]["Date"].date().isoformat()
                )
                result.at[index, "Actual_5D_Realized_Vol"] = realized_vol
                result.at[index, "Actual_5D_High_Risk"] = actual_high_risk
                if probability is not None:
                    result.at[index, "Risk_5D_Correct"] = int(
                        (probability >= 0.5) == bool(actual_high_risk)
                    )
    return result


def _new_ledger_row(
    prediction: pd.Series,
    generated_at: datetime,
    as_of_date: str,
) -> dict[str, object]:
    return {
        "Created_At": generated_at.isoformat(),
        "As_Of_Date": as_of_date,
        "Ticker": prediction.get("Ticker"),
        "Best_Model": prediction.get("Best_Model"),
        "Raw_Direction": prediction.get("Forecast_1D_Direction"),
        "Action_Signal": prediction.get("Forecast_1D_Signal"),
        "Signal_Quality": prediction.get("Signal_Quality"),
        "Forecast_1D_Return": prediction.get("Forecast_1D_Return"),
        "Risk_5D_Model": prediction.get("Risk_5D_Model"),
        "Risk_5D_Probability": prediction.get("Risk_5D_Probability"),
        "Risk_5D_Status": prediction.get("Risk_5D_Status"),
        "Risk_5D_Threshold_Daily_Vol": prediction.get(
            "Risk_5D_Threshold_Daily_Vol"
        ),
    }


def _mean_percent(series: pd.Series) -> float:
    return float(series.astype(float).mean() * 100) if len(series) else np.nan


def _to_float(value: object) -> float | None:
    if value is None or pd.isna(value):
        return None
    return float(value)
