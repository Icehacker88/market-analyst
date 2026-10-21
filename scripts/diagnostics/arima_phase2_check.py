"""Offline deterministic synthetic protocol/cost check; never evidence of market edge."""
from __future__ import annotations

import json
import platform
from pathlib import Path
import sys
import time

import numpy as np
import pandas as pd
import sklearn
import statsmodels

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "股票预测"))
from src.models import train_and_evaluate_models


def main() -> None:
    generator = np.random.default_rng(20261020)
    n = 200
    returns = generator.normal(.0003, .01, n + 1)
    prices = 100 * np.exp(np.cumsum(returns))
    data = pd.DataFrame({"Date": pd.bdate_range("2025-01-01", periods=n), "Price": prices[:-1],
        "Log_Return": returns[:-1], "Target_Log_Return": returns[1:], "Target_Price": prices[1:]})
    start = time.perf_counter()
    models, metrics = train_and_evaluate_models(data, ["Log_Return"], price_history=data)
    arima = next(model for model in models if model.name == "ARIMA")
    all_rows = pd.concat([arima.validation_predictions, arima.predictions])
    print(json.dumps({"source": "synthetic seed=20261020; no market-performance inference",
        "python": platform.python_version(), "numpy": np.__version__, "pandas": pd.__version__,
        "sklearn": sklearn.__version__, "statsmodels": statsmodels.__version__,
        "elapsed_seconds": round(time.perf_counter() - start, 3), "models": len(models),
        "cv_samples_per_model": metrics.CV_Samples.tolist(),
        "holdout_samples_per_model": metrics.Holdout_Samples.tolist(),
        "arima_status_counts": all_rows.Forecast_Status.value_counts().to_dict(),
        "arima_fallback_reasons": all_rows.loc[all_rows.Forecast_Status == "fallback", "Fallback_Reason"].value_counts().to_dict(),
        "cv_dates": [str(arima.validation_predictions.Date.min()), str(arima.validation_predictions.Date.max())],
        "holdout_dates": [str(arima.predictions.Date.min()), str(arima.predictions.Date.max())],
    }, indent=2))


if __name__ == "__main__":
    main()
