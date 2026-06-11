from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from src.prediction_ledger import build_latest_1d_validation, update_prediction_ledger


class PredictionLedgerTests(unittest.TestCase):
    def test_ledger_freezes_prediction_and_reconciles_actuals(self) -> None:
        dates = pd.date_range("2026-01-01", periods=8, freq="B")
        prices = [100, 101, 102, 104, 103, 106, 108, 109]
        full_market = pd.DataFrame(
            {
                "Date": dates,
                "Close": prices,
                "Adj Close": prices,
                "Volume": [1_000_000] * len(prices),
            }
        )
        prediction = pd.DataFrame(
            [
                {
                    "Ticker": "SPY",
                    "Best_Model": "ARIMA",
                    "Forecast_1D_Direction": "Up",
                    "Forecast_1D_Signal": "Up",
                    "Signal_Quality": "Medium",
                    "Forecast_1D_Return": 0.001,
                    "Risk_5D_Model": "Logistic Risk",
                    "Risk_5D_Probability": 0.7,
                    "Risk_5D_Status": "High",
                    "Risk_5D_Threshold_Daily_Vol": 0.005,
                    "Error": "",
                }
            ]
        )
        with tempfile.TemporaryDirectory() as directory:
            ledger_path = Path(directory) / "ledger.csv"
            update_prediction_ledger(
                ledger_path,
                prediction,
                {"SPY": full_market.iloc[:2]},
                datetime.now(timezone.utc),
            )
            ledger, metrics = update_prediction_ledger(
                ledger_path,
                pd.DataFrame(columns=["Ticker"]),
                {"SPY": full_market},
                datetime.now(timezone.utc),
            )

        self.assertEqual(len(ledger), 1)
        self.assertEqual(ledger.iloc[0]["Raw_Direction_Correct"], 1)
        self.assertEqual(ledger.iloc[0]["Action_Signal_Correct"], 1)
        self.assertFalse(pd.isna(ledger.iloc[0]["Risk_5D_Correct"]))
        spy_all = metrics[(metrics["Ticker"] == "SPY") & (metrics["Window"] == "All")]
        self.assertEqual(int(spy_all.iloc[0]["Completed_1D"]), 1)
        self.assertEqual(float(spy_all.iloc[0]["Raw_Direction_Accuracy"]), 100.0)
        self.assertGreater(float(spy_all.iloc[0]["Mean_Absolute_Return_Error"]), 0)

        validation = build_latest_1d_validation(ledger)
        self.assertEqual(len(validation), 1)
        self.assertEqual(validation.iloc[0]["Ticker"], "SPY")
        self.assertEqual(int(validation.iloc[0]["Direction_Correct"]), 1)
        self.assertAlmostEqual(
            float(validation.iloc[0]["Return_Error"]),
            float(validation.iloc[0]["Actual_Return"]) - 0.001,
        )
        self.assertAlmostEqual(
            float(validation.iloc[0]["Absolute_Return_Error"]),
            abs(float(validation.iloc[0]["Return_Error"])),
        )


if __name__ == "__main__":
    unittest.main()
