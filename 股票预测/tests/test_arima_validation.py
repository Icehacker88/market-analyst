from __future__ import annotations

import tempfile
import unittest
import warnings
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pandas as pd

from src.daily_report import _read_model_summary
from src.models import (
    ArimaReturnModel, BaselineReturnModel, TrainedModel,
    _cross_validated_direction_metrics, _evaluation_predictions,
    _observed_return_series, _rank_metrics, forecast_future_returns,
    refit_model_on_all_data, train_and_evaluate_models,
)
from src.prediction_ledger import _new_ledger_row
from datetime import datetime, timezone


class NextStepArima:
    """A deterministic time-alignment oracle, not a performance benchmark."""
    histories: list[np.ndarray] = []

    def __init__(self, series, order):
        self.series = np.asarray(series)
        self.histories.append(self.series.copy())
        self.mle_retvals = {"converged": True}

    def fit(self):
        return self

    def forecast(self, steps):
        return self.series[-1] + np.arange(1, steps + 1) * .001


def data_frame(n=200):
    returns = np.arange(n + 1) * .001
    prices = 100 * np.exp(np.cumsum(returns))
    return pd.DataFrame({"Date": pd.bdate_range("2025-01-01", periods=n),
                         "Price": prices[:-1], "Target_Price": prices[1:],
                         "Log_Return": returns[:-1], "Target_Log_Return": returns[1:]})


class ArimaValidationTests(unittest.TestCase):
    def setUp(self):
        NextStepArima.histories = []
        self.warning_context = warnings.catch_warnings()
        self.warning_context.__enter__()
        warnings.filterwarnings("ignore", message="A single label was found.*", category=UserWarning)
        warnings.filterwarnings("ignore", message="y_pred contains classes not in y_true", category=UserWarning)
        self.addCleanup(self.warning_context.__exit__, None, None, None)

    def test_gap_and_each_origin_use_only_realized_targets(self):
        data = data_frame()
        rows = []
        with patch("src.models.ARIMA", NextStepArima):
            metrics = _cross_validated_direction_metrics(
                ArimaReturnModel, data[["Log_Return"]], data.Target_Log_Return, rows)
        self.assertEqual(metrics["CV_Samples"], 150)
        self.assertEqual(metrics["CV_Fallback_Count"], 0)
        self.assertAlmostEqual(metrics["CV_Return_RMSE"], 0)
        self.assertEqual(len(NextStepArima.histories), 150)
        for record, history in zip(rows, NextStepArima.histories):
            origin = record["Origin_Position"]
            self.assertEqual(len(history), origin)
            self.assertAlmostEqual(history[-1], data.Log_Return.iloc[origin])
            self.assertAlmostEqual(record["Predicted_Return"], data.Target_Log_Return.iloc[origin])

    def test_future_targets_cannot_change_earlier_prediction(self):
        data = data_frame()
        changed = data.Target_Log_Return.copy()
        changed.iloc[60:] = -123
        with patch("src.models.ARIMA", NextStepArima):
            def predict(y):
                return _evaluation_predictions(ArimaReturnModel, data[["Log_Return"]], y,
                                               np.arange(58), np.arange(60, 62))[1]
            original, perturbed = predict(data.Target_Log_Return), predict(changed)
        self.assertEqual(original[0], perturbed[0])
        self.assertNotEqual(original[1], perturbed[1])  # yesterday's result is now observable

    def test_full_history_keeps_feature_filtered_bars_and_excludes_future(self):
        data = data_frame()
        filtered = data.drop(index=[50, 51, 52]).reset_index(drop=True)
        returns = _observed_return_series(data, data.Date.iloc[0])
        with patch("src.models.ARIMA", NextStepArima):
            _, values, _, _ = _evaluation_predictions(
                ArimaReturnModel, filtered[["Log_Return"]], filtered.Target_Log_Return,
                np.arange(49), np.array([50]), returns, filtered.Date)
        self.assertEqual(len(NextStepArima.histories[0]), 53)
        self.assertAlmostEqual(values[0], filtered.Target_Log_Return.iloc[50])
        self.assertAlmostEqual(NextStepArima.histories[0][-1], filtered.Log_Return.iloc[50])

    def test_future_price_history_does_not_leak_into_a_prior_origin(self):
        data = data_frame()
        changed = data.copy()
        changed.loc[61:, "Price"] *= 3
        with patch("src.models.ARIMA", NextStepArima):
            def predict(history):
                return _evaluation_predictions(ArimaReturnModel, data[["Log_Return"]], data.Target_Log_Return,
                    np.arange(58), np.array([60]), _observed_return_series(history, data.Date.iloc[0]), data.Date)[1]
            np.testing.assert_array_equal(predict(data), predict(changed))

    def test_holdout_perturbation_does_not_change_cv_scores_or_selection(self):
        data = data_frame()
        changed = data.copy()
        changed.loc[160:, "Target_Log_Return"] = -.1
        changed.loc[160:, "Target_Price"] = changed.loc[160:, "Price"] * np.exp(-.1)
        factories = [("ARIMA", ArimaReturnModel), ("Baseline", BaselineReturnModel)]
        with patch("src.models.ARIMA", NextStepArima), patch("src.models._candidate_factories", return_value=factories):
            trained, original = train_and_evaluate_models(data, ["Log_Return"])
            _, perturbed = train_and_evaluate_models(changed, ["Log_Return"])
        columns = ["Model", "Prediction_Score", *[c for c in original if c.startswith("CV_")]]
        pd.testing.assert_frame_equal(original[columns], perturbed[columns])
        self.assertFalse(original.Return_RMSE.equals(perturbed.Return_RMSE))
        self.assertEqual(len(trained[0].validation_predictions), 120)
        self.assertEqual(len(trained[0].predictions), 40)
        self.assertTrue((trained[0].predictions.Forecast_Status == "ok").all())

    def test_exact_cv_ties_use_model_name_not_holdout_errors(self):
        metrics = pd.DataFrame([{"Model": name, "CV_Directional_Edge": 1,
            "CV_Directional_Accuracy": 52, "CV_Balanced_Accuracy": 51,
            "CV_Return_RMSE": .01, "CV_MAPE": 1,
            "Return_RMSE": error, "MAPE": error} for name, error in [("B", 0), ("A", 999)]])
        self.assertEqual(_rank_metrics(metrics).Model.tolist(), ["A", "B"])
        metrics[["MAPE", "Return_RMSE"]] = metrics[["MAPE", "Return_RMSE"]].iloc[::-1].to_numpy()
        self.assertEqual(_rank_metrics(metrics).Model.tolist(), ["A", "B"])

    def test_batch_predict_is_rejected_but_multistep_forecast_is_explicit(self):
        data = data_frame()
        model = ArimaReturnModel().fit(data[["Log_Return"]], data.Target_Log_Return)
        with self.assertRaises(ValueError):
            model.predict(data.iloc[:2])
        with patch("src.models.ARIMA", NextStepArima):
            frame = forecast_future_returns(model, data, ["Log_Return"], 100, 5)
        np.testing.assert_allclose(frame.Predicted_Return, [.201, .202, .203, .204, .205])
        self.assertTrue((frame.Forecast_Status == "ok").all())

    def test_final_refit_uses_last_observed_bar_even_when_features_drop_rows(self):
        data = data_frame()
        truncated = data.iloc[:-3]
        trained = TrainedModel("ARIMA", ArimaReturnModel(), pd.DataFrame(), {})
        model = refit_model_on_all_data(trained, truncated, ["Log_Return"], price_history=data)
        self.assertAlmostEqual(model.series.iloc[-1], data.Log_Return.iloc[-1])

    def test_fit_failure_nonconvergence_and_invalid_forecast_are_visible(self):
        data = data_frame()
        model = ArimaReturnModel().fit(data[["Log_Return"]], data.Target_Log_Return)
        for result, reason in [
            (RuntimeError("synthetic"), "fit_or_forecast_error:RuntimeError"),
            (SimpleNamespace(mle_retvals={"converged": False}), "non_convergence"),
            (SimpleNamespace(mle_retvals={"converged": True}, forecast=lambda steps: [np.nan] * steps), "invalid_forecast"),
        ]:
            with patch("src.models.ARIMA") as arima:
                if isinstance(result, Exception):
                    arima.return_value.fit.side_effect = result
                else:
                    arima.return_value.fit.return_value = result
                values = model.forecast_steps(5)
            self.assertEqual(model.forecast_status, "fallback")
            self.assertEqual(model.fallback_reason, reason)
            np.testing.assert_allclose(values, data.Target_Log_Return.median())
        model.fit(data.iloc[:5], data.Target_Log_Return.iloc[:5]).forecast_steps(1)
        self.assertEqual(model.fallback_reason, "insufficient_history")

    def test_failed_origins_remain_in_metrics_and_have_per_date_evidence(self):
        data = data_frame()
        rows = []
        with patch("src.models.ARIMA", side_effect=RuntimeError("synthetic")):
            metrics = _cross_validated_direction_metrics(ArimaReturnModel, data[["Log_Return"]], data.Target_Log_Return, rows)
        self.assertEqual(metrics["CV_Samples"], metrics["CV_Fallback_Count"])
        self.assertEqual(len(rows), metrics["CV_Samples"])
        self.assertTrue(all(r["Forecast_Status"] == "fallback" for r in rows))
        self.assertTrue(np.isfinite(metrics["CV_Return_RMSE"]))

    def test_daily_summary_and_new_ledger_row_keep_fallback_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            pd.DataFrame([dict(Model="ARIMA", Directional_Accuracy=60, Balanced_Accuracy=60,
                Majority_Baseline_Accuracy=50, Directional_Edge=10, CV_Directional_Accuracy=60,
                CV_Balanced_Accuracy=60, CV_Directional_Edge=10, CV_Fallback_Count=22, CV_Samples=100, MAPE=1)]).to_csv(path / "model_comparison.csv", index=False)
            pd.DataFrame([dict(Predicted_Price=101, Predicted_Return=.01, Predicted_Direction="Up",
                Forecast_Status="fallback", Fallback_Reason="non_convergence")]).to_csv(path / "forecast_1d_5d.csv", index=False)
            pd.DataFrame({"Price": [100]}).to_csv(path / "cleaned_prices.csv", index=False)
            summary = _read_model_summary("SPY", path)
            metrics = pd.read_csv(path / "model_comparison.csv")
            baseline = metrics.assign(Model="Baseline", CV_Fallback_Count=0)
            pd.concat([baseline, metrics]).to_csv(path / "model_comparison.csv", index=False)
            other_winner = _read_model_summary("SPY", path)
            self.assertEqual(other_winner["Best_Model"], "Baseline")
            self.assertEqual(other_winner["ARIMA_CV_Fallback_Count"], 22)
            self.assertEqual(other_winner["ARIMA_CV_Samples"], 100)
        self.assertEqual(summary["Forecast_1D_Signal"], "Observe")
        self.assertEqual(summary["Signal_Quality"], "Low")
        row = _new_ledger_row(pd.Series(summary), datetime.now(timezone.utc), "2026-10-20")
        self.assertEqual(row["Model_Forecast_Status"], "fallback")
        self.assertEqual(row["Model_Fallback_Reason"], "non_convergence")

    def test_real_statsmodels_forecasts_both_mean_signs(self):
        noise = np.random.default_rng(42).normal(0, .01, 180)
        for mean in [-.03, .03]:
            model = ArimaReturnModel(order=(1, 0, 0)).fit(pd.DataFrame(), pd.Series(mean + noise))
            values = model.forecast_steps(5)
            self.assertEqual(model.forecast_status, "ok")
            self.assertTrue(np.isfinite(values).all())
            self.assertTrue((np.sign(values) == np.sign(mean)).all())


if __name__ == "__main__":
    unittest.main()
