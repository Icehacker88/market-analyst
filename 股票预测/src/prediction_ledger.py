from __future__ import annotations

from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd

from src.preprocessing import clean_price_data
from src.forecast_eligibility import (SETTLEMENT_BASIS, HORIZONS, VERSION, make_snapshot, outcome_eligible,
                                      qualify, session, timestamp)


LEDGER_COLUMNS = [
    "Evaluation_Snapshot_JSON",
    "Outcome_Evidence_JSON",
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
    "Evaluation_Snapshot_JSON",
    "Outcome_Evidence_JSON",
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
VALIDATION_COLUMNS = [
    "Prediction_Date",
    "Actual_Date",
    "Ticker",
    "Best_Model",
    "Forecast_Return",
    "Actual_Return",
    "Return_Error",
    "Absolute_Return_Error",
    "Forecast_Direction",
    "Actual_Direction",
    "Direction_Correct",
    "Action_Signal",
    "Action_Signal_Correct",
]


def update_prediction_ledger(
    ledger_path: Path,
    prediction_frame: pd.DataFrame,
    market_frames: dict[str, pd.DataFrame],
    generated_at: datetime,
    market_provenance: dict[str, dict[str, str]] | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    ledger = _load_ledger(ledger_path)
    ledger = _reconcile_actuals(ledger, market_frames, market_provenance or {})
    existing_keys = set(zip(ledger["Ticker"], ledger["As_Of_Date"]))
    new_rows = []
    for _, prediction in prediction_frame.iterrows():
        ticker = str(prediction.get("Ticker", ""))
        if (pd.notna(prediction.get("Error")) and prediction.get("Error")) or ticker not in market_frames:
            continue
        cleaned, _ = clean_price_data(market_frames[ticker])
        as_of_date = pd.to_datetime(cleaned["Date"].iloc[-1]).date().isoformat()
        if (ticker, as_of_date) in existing_keys:
            continue
        row = _new_ledger_row(prediction, generated_at, as_of_date)
        provenance = (market_provenance or {}).get(ticker, {})
        snapshot = make_snapshot(ticker, as_of_date, float(settlement_closes(cleaned).get(as_of_date, 0.0)), SETTLEMENT_BASIS,
                                 provenance.get("source", ""), provenance.get("observed_at", ""),
                                 str(prediction.get("Forecast_Generated_At", "")), "")
        row["Evaluation_Snapshot_JSON"] = json.dumps(snapshot, sort_keys=True)
        new_rows.append(row)
        existing_keys.add((ticker, as_of_date))
    if new_rows:
        new_frame = pd.DataFrame(new_rows).reindex(columns=LEDGER_COLUMNS)
        ledger = (
            new_frame
            if ledger.empty
            else pd.concat([ledger, new_frame], ignore_index=True)
        )
    ledger = ledger.reindex(columns=list(dict.fromkeys([*LEDGER_COLUMNS, *ledger.columns]))).sort_values(
        ["As_Of_Date", "Ticker"]
    )
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    # Publish complete immutable input first; missing acknowledgement on a crash stays unknown.
    _atomic_write(ledger, ledger_path)
    frozen_at = datetime.now(timezone.utc).isoformat()
    new_keys = {(r["Ticker"], r["As_Of_Date"]) for r in new_rows}
    for index, row in ledger.iterrows():
        if (row["Ticker"], row["As_Of_Date"]) in new_keys:
            snapshot = json.loads(row["Evaluation_Snapshot_JSON"])
            snapshot["frozen_at"] = frozen_at
            ledger.at[index, "Evaluation_Snapshot_JSON"] = json.dumps(snapshot, sort_keys=True)
    if new_rows:
        _atomic_write(ledger, ledger_path)
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
            eligible_1d = sample.apply(lambda r: outcome_eligible(_evaluation_row(r), "1D"), axis=1).astype(bool)
            eligible_5d = sample.apply(lambda r: outcome_eligible(_evaluation_row(r), "5D"), axis=1).astype(bool)
            direction = sample.loc[eligible_1d].dropna(subset=["Raw_Direction_Correct"])
            actionable = sample.loc[eligible_1d].dropna(subset=["Action_Signal_Correct"])
            risk = sample.loc[eligible_5d].dropna(subset=["Risk_5D_Correct"])
            states = [qualify(_evaluation_row(r))["status"] for _, r in sample.iterrows()]
            return_errors = _return_errors(direction)
            rows.append(
                {
                    "Evaluation_Protocol": VERSION,
                    "Observed_1D": int(sample["Actual_1D_Return"].notna().sum()),
                    "Eligible_1D": states.count("eligible"),
                    "Ineligible_1D": states.count("ineligible"),
                    "Unknown_1D": states.count("unknown"),
                    "Excluded_1D": int(sample["Actual_1D_Return"].notna().sum()) - len(direction),
                    "Ticker": ticker,
                    "Window": "All" if window is None else str(window),
                    "Completed_1D": len(direction),
                    "Raw_Direction_Accuracy": _mean_percent(
                        direction["Raw_Direction_Correct"]
                    ),
                    "Mean_Absolute_Return_Error": (
                        float(return_errors.abs().mean())
                        if len(return_errors)
                        else np.nan
                    ),
                    "Mean_Return_Error": (
                        float(return_errors.mean()) if len(return_errors) else np.nan
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


def build_latest_1d_validation(ledger: pd.DataFrame) -> pd.DataFrame:
    qualified = ledger.loc[ledger.apply(lambda r: outcome_eligible(_evaluation_row(r), "1D"), axis=1).astype(bool)]
    completed = qualified.dropna(
        subset=["Actual_1D_Date", "Actual_1D_Return", "Forecast_1D_Return"]
    ).copy()
    if completed.empty:
        return pd.DataFrame(columns=VALIDATION_COLUMNS)
    completed["Actual_1D_Date"] = completed["Actual_1D_Date"].astype(str)
    latest = (
        completed.sort_values(["Ticker", "Actual_1D_Date", "As_Of_Date"])
        .groupby("Ticker", sort=True, as_index=False)
        .tail(1)
        .sort_values("Ticker")
    )
    forecast_return = pd.to_numeric(latest["Forecast_1D_Return"], errors="coerce")
    actual_return = pd.to_numeric(latest["Actual_1D_Return"], errors="coerce")
    return_error = actual_return - forecast_return
    validation = pd.DataFrame(
        {
            "Prediction_Date": latest["As_Of_Date"].values,
            "Actual_Date": latest["Actual_1D_Date"].values,
            "Ticker": latest["Ticker"].values,
            "Best_Model": latest["Best_Model"].values,
            "Forecast_Return": forecast_return.values,
            "Actual_Return": actual_return.values,
            "Return_Error": return_error.values,
            "Absolute_Return_Error": return_error.abs().values,
            "Forecast_Direction": latest["Raw_Direction"].values,
            "Actual_Direction": latest["Actual_1D_Direction"].values,
            "Direction_Correct": latest["Raw_Direction_Correct"].values,
            "Action_Signal": latest["Action_Signal"].values,
            "Action_Signal_Correct": latest["Action_Signal_Correct"].values,
        }
    )
    return validation.reindex(columns=VALIDATION_COLUMNS).reset_index(drop=True)


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
    return ledger.reindex(columns=list(dict.fromkeys([*LEDGER_COLUMNS, *ledger.columns])))


def settlement_closes(cleaned: pd.DataFrame) -> pd.Series:
    """Positive unadjusted closes keyed by ISO date, the live freeze/settlement basis.

    Unlike Adj Close, past closes are not rewritten at ex-dividend dates (only by splits).
    """
    if "Close" not in cleaned.columns:
        return pd.Series(dtype=float)
    closes = pd.Series(pd.to_numeric(cleaned["Close"], errors="coerce").to_numpy(),
                       index=pd.to_datetime(cleaned["Date"]).dt.date.astype(str).to_numpy())
    return closes[np.isfinite(closes) & (closes > 0)]


def _evaluation_row(row: pd.Series) -> dict:
    result = row.to_dict()
    for key in ["Evaluation_Snapshot", "Outcome_Evidence"]:
        try:
            parsed = json.loads(str(row.get(key + "_JSON", "")))
            result[key] = parsed if isinstance(parsed, dict) else {}
        except (ValueError, TypeError):
            result[key] = {}
    return result


def _atomic_write(frame: pd.DataFrame, path: Path) -> None:
    # The scheduled workflow is serialized; replace prevents a partially written CSV.
    temporary = path.with_name(path.name + ".tmp")
    try:
        frame.to_csv(temporary, index=False)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _reconcile_actuals(
    ledger: pd.DataFrame,
    market_frames: dict[str, pd.DataFrame],
    provenance: dict[str, dict[str, str]] | None = None,
) -> pd.DataFrame:
    result = ledger.copy()
    now = datetime.now(timezone.utc)
    for ticker, raw in market_frames.items():
        cleaned, _ = clean_price_data(raw)
        closes = settlement_closes(cleaned)
        origin = (provenance or {}).get(ticker, {})
        observed = timestamp(origin.get("observed_at"))
        for index in result.index[result["Ticker"] == ticker]:
            row = _evaluation_row(result.loc[index])
            if qualify(row, now=now)["status"] != "eligible":
                continue  # Never settle/backfill legacy or disqualified records.
            snapshot = row["Evaluation_Snapshot"]
            base = snapshot["base_session"]
            if (base not in closes.index or snapshot["price_basis"] != SETTLEMENT_BASIS
                    or origin.get("source") != snapshot["source"] or observed is None or observed > now
                    or not np.isclose(float(closes[base]), snapshot["base_price"], rtol=1e-10, atol=1e-8)):
                continue  # A split or data revision cannot silently change the frozen denominator.
            evidence = dict(row["Outcome_Evidence"])
            for horizon in ["1D", "5D"]:
                actual_column = "Actual_1D_Return" if horizon == "1D" else "Actual_5D_Realized_Vol"
                if pd.notna(row.get(actual_column)) or qualify(row, horizon, now)["status"] != "eligible":
                    continue
                dates = snapshot["target_sessions"][:HORIZONS[horizon]]
                target = dates[-1]
                if any(d not in closes.index for d in dates) or observed < session(target)[1] + timedelta(minutes=15):
                    continue
                prices = np.array([snapshot["base_price"], *[float(closes[d]) for d in dates]])
                if not np.isfinite(prices).all() or (prices <= 0).any():
                    continue
                if horizon == "1D":
                    actual = float(np.log(prices[-1] / prices[0]))
                    direction = "Up" if actual >= 0 else "Down"
                    result.at[index, "Actual_1D_Date"] = target
                    result.at[index, "Actual_1D_Return"] = actual
                    result.at[index, "Actual_1D_Direction"] = direction
                    result.at[index, "Raw_Direction_Correct"] = int(row["Raw_Direction"] == direction)
                    if row["Action_Signal"] in {"Up", "Down"}:
                        result.at[index, "Action_Signal_Correct"] = int(row["Action_Signal"] == direction)
                else:
                    threshold, probability = _to_float(row.get("Risk_5D_Threshold_Daily_Vol")), _to_float(row.get("Risk_5D_Probability"))
                    if threshold is None:
                        continue
                    realized = float(np.sqrt(np.mean(np.diff(np.log(prices)) ** 2)))
                    high = int(realized > threshold)
                    result.at[index, "Actual_5D_Date"] = target
                    result.at[index, "Actual_5D_Realized_Vol"] = realized
                    result.at[index, "Actual_5D_High_Risk"] = high
                    if probability is not None:
                        result.at[index, "Risk_5D_Correct"] = int((probability >= .5) == bool(high))
                evidence[horizon] = dict(source=snapshot["source"], price_basis=snapshot["price_basis"],
                    base_price=snapshot["base_price"], actual_price=float(prices[-1]), target_session=target,
                    source_observed_at=origin["observed_at"], settled_at=now.isoformat())
            if evidence != row["Outcome_Evidence"]:
                result.at[index, "Outcome_Evidence_JSON"] = json.dumps(evidence, sort_keys=True)
    return result


def _new_ledger_row(
    prediction: pd.Series,
    generated_at: datetime,
    as_of_date: str,
) -> dict[str, object]:
    return {
        "Created_At": prediction.get("Forecast_Generated_At", generated_at.isoformat()),
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


def _return_errors(frame: pd.DataFrame) -> pd.Series:
    forecast = pd.to_numeric(frame["Forecast_1D_Return"], errors="coerce")
    actual = pd.to_numeric(frame["Actual_1D_Return"], errors="coerce")
    return (actual - forecast).dropna()


def _to_float(value: object) -> float | None:
    if value is None or pd.isna(value):
        return None
    return float(value)
