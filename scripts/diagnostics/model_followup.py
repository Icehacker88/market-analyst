"""Offline model diagnostics. Reads explicit local files; never fetches or writes data."""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo


def number(value):
    if value is None or value == "":
        return None
    result = float(value)
    return result if math.isfinite(result) else None


def summary(rows, horizon="1D"):
    actual_key = f"Actual_{horizon}_Return"
    correct_key = "Raw_Direction_Correct" if horizon == "1D" else f"Direction_Correct_{horizon}"
    settled = [r for r in rows if number(r.get(actual_key)) is not None and number(r.get(correct_key)) is not None]
    if not settled:
        return {"n": 0}
    pct = lambda values: round(100 * sum(values) / len(values), 4)
    up = pct([number(r[actual_key]) >= 0 for r in settled])
    accuracy = pct([number(r[correct_key]) for r in settled])
    dates = sorted({r["As_Of_Date"] for r in settled})
    return {"n": len(settled), "distinct_as_of_dates": len(dates), "start": dates[0], "end": dates[-1],
            "accuracy": accuracy, "actual_up_pct": up, "majority_baseline": max(up, 100-up),
            "edge": round(accuracy-max(up, 100-up), 4),
            "predicted_up_pct": pct([number(r[f"Forecast_{horizon}_Return"]) >= 0 for r in settled])}


def grouped(rows, keys):
    groups = defaultdict(list)
    for row in rows:
        key = "/".join(row["As_Of_Date"][:7] if k == "month" else str(row.get(k, "")) for k in keys)
        groups[key].append(row)
    return {key: summary(value) for key, value in sorted(groups.items())}


def timing_screen(rows):
    """Conservative timestamp screen, NOT an exchange-calendar eligibility rule."""
    late, examined = [], []
    for row in rows:
        if row.get("Ticker") not in {"SPY", "QQQ", "NVDA", "^NDX", "^VIX"} or not row.get("Actual_1D_Date"):
            continue
        created = datetime.fromisoformat(row["Created_At"].replace("Z", "+00:00"))
        if created.tzinfo is None:
            raise ValueError("Created_At requires timezone; do not infer it")
        cutoff = datetime.fromisoformat(row["Actual_1D_Date"][:10]+"T17:00:00").replace(tzinfo=ZoneInfo("America/New_York"))
        examined.append(row)
        if created > cutoff:
            late.append(row)
    late_ids = {id(row) for row in late}
    return {"rule": "US assets only; Created_At later than Actual_1D_Date at 17:00 America/New_York; verify date semantics before excluding",
            "examined": len(examined), "flagged": len(late), "flagged_by_model": grouped(late, ["Best_Model"]),
            "examples": [{k: row[k] for k in ["Ticker", "As_Of_Date", "Actual_1D_Date", "Created_At"]} for row in late[:3]],
            "sensitivity_without_flagged": summary([row for row in rows if id(row) not in late_ids])}


def cloud_stats(rows):
    safe = [r for r in rows if r.get("Best_Model") == "Orivane Ensemble Safe Mode"]
    reconstruction = {}
    for horizon, cap in [("1D", .05), ("5D", .25), ("10D", .35), ("1M", .55)]:
        errors, mismatch, components = [], 0, defaultdict(list)
        for row in safe:
            values = row.get("Model_Components") or []
            field = f"forecast_{horizon.lower()}_return"
            if not values or any(number(c.get(field)) is None or number(c.get("weight")) is None for c in values):
                continue
            prediction = max(-cap, min(cap, sum(c["weight"] * c[field] for c in values)))
            frozen = number(row.get(f"Forecast_{horizon}_Return"))
            if frozen is None:
                continue
            errors.append(abs(prediction-frozen))
            mismatch += (prediction >= 0) != (frozen >= 0)
            actual = number(row.get(f"Actual_{horizon}_Return"))
            if actual is not None:
                for component in values:
                    components[component["model"]].append((component[field] >= 0) == (actual >= 0))
        reconstruction[horizon] = {
            "reconstructed": len(errors), "max_abs_error": max(errors, default=None), "sign_mismatches": mismatch,
            "ensemble": summary(safe, horizon),
            "component_hits": {k: {"n": len(v), "hits": sum(v), "accuracy": round(sum(v)/len(v)*100, 4)} for k, v in components.items()}}
    # A same-asset/date alternate-model observation is required for a paired comparison.
    keys = defaultdict(set)
    for row in rows:
        keys[(row["Ticker"], row["As_Of_Date"])].add(row["Best_Model"])
    paired = sum({"Orivane Horizon Router", "Orivane Ensemble Safe Mode"}.issubset(models) for models in keys.values())
    return {"rows": len(rows), "timing_screen": timing_screen(rows), "by_model": grouped(rows, ["Best_Model"]),
            "by_model_asset": grouped(rows, ["Best_Model", "Ticker"]),
            "by_model_month": grouped(rows, ["Best_Model", "month"]),
            "router_safe_same_asset_date_pairs": paired, "safe_reconstruction": reconstruction}


def python_probes(repo):
    """Use local src.models, synthetic values and a spy; no data pipeline execution."""
    import sys
    sys.path.insert(0, str(repo / "股票预测"))
    import numpy as np
    import pandas as pd
    import sklearn
    import statsmodels
    import src.models as models
    from unittest.mock import patch
    rows = 120
    x = pd.DataFrame({"index": np.arange(rows)})
    y = pd.Series(np.arange(rows, dtype=float))
    fits, requests = [], []

    class FakeArima:
        def __init__(self, series, order):
            fits.append({"last_target_index": int(series.index[-1]), "last_value": float(series.iloc[-1])})
        def fit(self):
            return self
        def forecast(self, steps):
            requests.append(steps)
            return np.arange(1, steps+1, dtype=float)

    with patch.object(models, "ARIMA", FakeArima):
        model = models.ArimaReturnModel().fit(x, y)
        model.predict(pd.DataFrame({"index": range(120, 130)}))
        model.predict(pd.DataFrame({"index": range(999, 1009)}))
    assert requests == [10, 10]
    # Actual CV split: targets are next-session returns; gap=1 requires skipping
    # one forecast step before comparing the first validation target.
    splits = []
    for train, valid in models.TimeSeriesSplit(n_splits=3, gap=1).split(x):
        splits.append({"last_train_feature": int(train[-1]), "first_validation_feature": int(valid[0]),
                       "first_predicted_return_time": int(train[-1])+2,
                       "first_validation_target_time": int(valid[0])+1})
    assert all(s["first_validation_target_time"]-s["first_predicted_return_time"] == 1 for s in splits)
    shared = {"CV_Directional_Edge": -1., "CV_Balanced_Accuracy": 49., "CV_Directional_Accuracy": 49.}
    a = {"Model": "A", **shared, "Return_RMSE": .01, "MAPE": .5}
    b = {"Model": "B", **shared, "Return_RMSE": .02, "MAPE": 1.}
    winner_before = models._rank_metrics(pd.DataFrame([a, b])).iloc[0]["Model"]
    a.update(Return_RMSE=.03, MAPE=2.)
    winner_after = models._rank_metrics(pd.DataFrame([a, b])).iloc[0]["Model"]
    assert winner_before == "A" and winner_after == "B"
    import warnings
    signed_forecasts = {}
    with warnings.catch_warnings(record=True) as observed_warnings:
        for sign in [-1, 1]:
            synthetic = pd.Series(sign * .004 + np.sin(np.arange(rows) * .7) * .001)
            forecast = models.ArimaReturnModel().fit(x, synthetic).forecast_steps(5)
            assert (forecast[0] >= 0) == (sign > 0)
            signed_forecasts[str(sign)] = forecast.tolist()
    return {"versions": {"numpy": np.__version__, "pandas": pd.__version__, "sklearn": sklearn.__version__, "statsmodels": statsmodels.__version__},
            "arima_spy_forecast_lengths": requests, "cv_temporal_alignment": splits,
            "synthetic_signed_forecasts": signed_forecasts, "synthetic_fit_warnings": len(observed_warnings),
            "holdout_only_change_winners": [winner_before, winner_after],
            "selected_negative_cv_quality": models.classify_signal_quality(shared),
            "negative_quality_action": models.actionable_signal("Up", models.classify_signal_quality(shared))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", required=True, type=Path)
    parser.add_argument("--cloud", nargs="*", type=Path, default=[])
    parser.add_argument("--probe-python", action="store_true")
    args = parser.parse_args()
    sources = [args.ledger, *args.cloud]
    manifest = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    ledger = list(csv.DictReader(args.ledger.open()))
    output = {"input_sha256": manifest, "ledger": {"rows": len(ledger), "overall": summary(ledger), "timing_screen": timing_screen(ledger),
              "by_model": grouped(ledger, ["Best_Model"]), "by_model_asset": grouped(ledger, ["Best_Model", "Ticker"]),
              "by_model_month": grouped(ledger, ["Best_Model", "month"])}}
    if args.cloud:
        cloud = [row for p in args.cloud for row in json.loads(p.read_text())["data"]["live"]["records"]]
        output["cloud"] = cloud_stats(cloud)
    if args.probe_python:
        output["python_probes"] = python_probes(Path(__file__).resolve().parents[2])
    print(json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
